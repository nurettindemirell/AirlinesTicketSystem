require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const amqp = require('amqplib');
const { requireAuth, requireRole, requireServiceAuth, ROLES } = require('./middleware/auth');
const db = require('./utils/db');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// RABBITMQ AYARLARI (Mesaj kuyruğu)
// ============================================
let rabbitChannel = null;
let rabbitRetryCount = 0;
const MAX_RABBIT_RETRIES = 5;
const RABBIT_CONNECT_TIMEOUT = 5000; // 5 seconds

const QUEUES = {
    WELCOME_EMAIL: 'welcome_email_queue',
    POINTS_NOTIFICATION: 'points_notification_queue'
};

const connectRabbitMQ = async () => {
    try {
        if (!process.env.RABBITMQ_URL) {
            console.log('⚠️  RABBITMQ_URL not configured - queue functionality disabled');
            return;
        }

        if (rabbitRetryCount >= MAX_RABBIT_RETRIES) {
            console.log(`⚠️  RabbitMQ max retries (${MAX_RABBIT_RETRIES}) reached. Queue functionality disabled.`);
            return;
        }

        rabbitRetryCount++;
        console.log(`🔄 RabbitMQ connection attempt ${rabbitRetryCount}/${MAX_RABBIT_RETRIES}...`);

        const connectPromise = amqp.connect(process.env.RABBITMQ_URL);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout')), RABBIT_CONNECT_TIMEOUT)
        );

        const connection = await Promise.race([connectPromise, timeoutPromise]);
        rabbitChannel = await connection.createChannel();

        await rabbitChannel.assertQueue(QUEUES.WELCOME_EMAIL, { durable: true });
        await rabbitChannel.assertQueue(QUEUES.POINTS_NOTIFICATION, { durable: true });

        console.log('✅ Connected to RabbitMQ');
        rabbitRetryCount = 0;

        connection.on('error', (err) => {
            console.error('RabbitMQ connection error:', err.message);
            rabbitChannel = null;
            if (rabbitRetryCount < MAX_RABBIT_RETRIES) {
                setTimeout(connectRabbitMQ, 5000);
            }
        });

        connection.on('close', () => {
            rabbitChannel = null;
            if (rabbitRetryCount < MAX_RABBIT_RETRIES) {
                setTimeout(connectRabbitMQ, 5000);
            }
        });

    } catch (error) {
        console.log('⚠️  RabbitMQ connection failed:', error.message);
        rabbitChannel = null;
        if (rabbitRetryCount < MAX_RABBIT_RETRIES) {
            setTimeout(connectRabbitMQ, 5000);
        }
    }
};

if (process.env.RABBITMQ_URL) {
    setImmediate(connectRabbitMQ);
}

const sendToQueue = async (queueName, message) => {
    if (!rabbitChannel) {
        console.log(`⚠️  Queue not available, message not sent: ${queueName}`);
        return false;
    }
    try {
        rabbitChannel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), { persistent: true });
        console.log(`📤 Message queued to ${queueName}`);
        return true;
    } catch (error) {
        console.error(`Error sending message to ${queueName}:`, error);
        return false;
    }
};

// ============================================
// HEALTH ENDPOINTS
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'miles-service', timestamp: new Date().toISOString() });
});

app.get('/api/v1/miles/health', (req, res) => {
    res.json({ status: 'ok', endpoint: 'miles', timestamp: new Date().toISOString() });
});

// ============================================
// MEMBER ENDPOINTS
// ============================================

// POST /api/v1/miles/members - Yeni MilesSmiles üyeliği oluştur
app.post('/api/v1/miles/members', async (req, res) => {
    try {
        const { email, first_name, last_name, phone, user_id } = req.body;

        if (!email || !first_name || !last_name || !user_id) {
            return res.status(400).json({
                error: 'Missing required fields: email, first_name, last_name, user_id'
            });
        }

        // Üye numarası oluştur
        const { data: lastMember } = await db.querySingle(
            'SELECT TOP 1 member_number FROM miles_members ORDER BY created_at DESC'
        );

        let memberNo = 'MS00000001';
        if (lastMember?.member_number) {
            const lastNum = parseInt(lastMember.member_number.substring(2));
            memberNo = 'MS' + String(lastNum + 1).padStart(8, '0');
        }

        const insertQuery = `
            INSERT INTO miles_members (user_id, member_number, email, first_name, last_name, phone, total_points, tier)
            OUTPUT INSERTED.*
            VALUES (@user_id, @member_number, @email, @first_name, @last_name, @phone, 0, 'CLASSIC')
        `;

        const { data: member, error } = await db.querySingle(insertQuery, {
            user_id, member_number: memberNo, email, first_name, last_name, phone
        });

        if (error) {
            console.error('Error creating member:', error);
            if (error.number === 2627) { // Unique constraint violation
                return res.status(409).json({ error: 'Member already exists with this email or user_id' });
            }
            return res.status(500).json({ error: 'Failed to create membership' });
        }

        // Hoş geldin mailini sıraya at
        await sendToQueue(QUEUES.WELCOME_EMAIL, {
            email: member.email,
            first_name: member.first_name,
            last_name: member.last_name,
            member_number: member.member_number,
            tier: member.tier
        });

        res.status(201).json({
            message: 'Membership created successfully',
            member
        });

    } catch (error) {
        console.error('Error creating membership:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/miles/members/by-user/:userId
app.get('/api/v1/miles/members/by-user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: member, error } = await db.querySingle(
            'SELECT * FROM miles_members WHERE user_id = @userId',
            { userId }
        );

        if (error || !member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        res.json({ member });
    } catch (error) {
        console.error('Error fetching member by user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/miles/members/:id
app.get('/api/v1/miles/members/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { data: member, error } = await db.querySingle(
            'SELECT * FROM miles_members WHERE id = @id',
            { id: parseInt(id) }
        );

        if (error || !member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        if (req.user.id !== member.user_id && !req.user.roles.includes(ROLES.ADMIN)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ member });

    } catch (error) {
        console.error('Error fetching member:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/miles/members/:id/history
app.get('/api/v1/miles/members/:id/history', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const { data: ledger, error } = await db.query(
            `SELECT * FROM miles_ledger WHERE member_id = @id ORDER BY created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { id: parseInt(id), offset: parseInt(offset), limit: parseInt(limit) }
        );

        const { data: countResult } = await db.querySingle(
            `SELECT COUNT(*) as count FROM miles_ledger WHERE member_id = @id`,
            { id: parseInt(id) }
        );

        if (error) {
            return res.status(500).json({ error: 'Failed to fetch history' });
        }

        res.json({
            history: ledger,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult?.count || 0,
                totalPages: Math.ceil((countResult?.count || 0) / parseInt(limit))
            }
        });

    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/v1/miles/add', requireServiceAuth, async (req, res) => {
    try {
        const { member_number, member_id, points, description, source = 'Partner Airline', flight_id } = req.body;

        if ((!member_number && !member_id) || !points || points <= 0) {
            return res.status(400).json({ error: 'Missing required fields (member_number or member_id, and points)' });
        }

        let member;
        let memberError;

        if (member_id) {
            const result = await db.querySingle(
                'SELECT * FROM miles_members WHERE id = @id',
                { id: member_id }
            );
            member = result.data;
            memberError = result.error;
        } else {
            const result = await db.querySingle(
                'SELECT * FROM miles_members WHERE member_number = @num',
                { num: member_number }
            );
            member = result.data;
            memberError = result.error;
        }

        if (memberError || !member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Puanları güncelle
        await db.query(
            'UPDATE miles_members SET total_points = total_points + @points WHERE id = @id',
            { points, id: member.id }
        );

        // Record in ledger
        await db.query(
            `INSERT INTO miles_ledger (member_id, transaction_type, points, description, source, flight_id) 
             VALUES (@id, 'EARNED', @points, @desc, @source, @fid)`,
            { id: member.id, points, desc: description || `Points credited by ${source}`, source, fid: flight_id || null }
        );

        res.json({
            message: 'Points added successfully',
            member_number: member.member_number,
            points_added: points,
            new_total: member.total_points + points,
            source
        });

    } catch (error) {
        console.error('Error adding miles:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/v1/miles/redeem - Uçuş için mil harca (puan düş)
app.post('/api/v1/miles/redeem', requireServiceAuth, async (req, res) => {
    try {
        const { member_id, points, description, flight_id } = req.body;

        if (!member_id || !points || points <= 0) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { data: member, error: memberError } = await db.querySingle(
            'SELECT * FROM miles_members WHERE id = @id',
            { id: member_id }
        );

        if (memberError || !member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        if (member.total_points < points) {
            return res.status(400).json({ error: 'Insufficient points', current_points: member.total_points });
        }

        // Puanları düş
        await db.query(
            'UPDATE miles_members SET total_points = total_points - @points WHERE id = @id',
            { points, id: member.id }
        );

        // Record in ledger
        await db.query(
            `INSERT INTO miles_ledger (member_id, transaction_type, points, description, flight_id, source) 
             VALUES (@id, 'REDEEMED', @points, @desc, @fid, 'Flight Booking')`,
            {
                id: member.id,
                points: -points, // Store as negative for ledger? Or just positive with type REDEEMED. Usually REDEEMED implies negative.
                // Let's store positive 100 in points column but REDEEMED type. 
                // Wait, if I sum points later, it might differ. Let's make it intuitive.
                // Ledger logic: sum(points) should match balance? If so, it should be negative.
                // Let's look at schema: points INT.
                // Let's check 'EARNED' logic: +points.
                // So 'REDEEMED' should be -points if we want SUM() to work.
                // But typically ledger stores absolute value and type.
                // Let's check 'ADD' logic: "total_points = total_points + @points".
                // Let's store -points in ledger for clarity if I use sum().
                // Actually, let's keep it safe: type REDEEMED, points negative.
                points: -points,
                desc: description || 'Redeemed for flight booking',
                fid: flight_id
            }
        );

        res.json({
            message: 'Points redeemed successfully',
            member_number: member.member_number,
            points_redeemed: points,
            new_total: member.total_points - points
        });

    } catch (error) {
        console.error('Error redeeming miles:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// GECE İŞİ (Nightly Job): Biten uçuşlar için milleri işle
// ============================================
const processCompletedFlights = async () => {
    console.log('🌙 Starting nightly miles processing...');
    try {
        // İniş yapmış (LANDED) ama henüz işlenmemiş uçuşları getir
        const { data: completedFlights } = await db.query(`
            SELECT id, duration_minutes FROM flights 
            WHERE status = 'LANDED' 
            AND id NOT IN (SELECT flight_id FROM processed_flight_miles)
        `);

        if (!completedFlights || completedFlights.length === 0) {
            console.log('No new completed flights to process');
            return;
        }

        let totalBookingsProcessed = 0;
        let totalPointsAwarded = 0;

        for (const flight of completedFlights) {
            // Get bookings with miles members
            const { data: bookings } = await db.query(
                `SELECT b.*, m.id as m_id, m.email, m.first_name, m.total_points FROM bookings b
                 JOIN miles_members m ON b.miles_member_id = m.id
                 WHERE b.flight_id = @fid AND b.status = 'CONFIRMED'`,
                { fid: flight.id }
            );

            const pointsPerPassenger = flight.duration_minutes || 100;

            for (const booking of bookings) {
                const totalPoints = pointsPerPassenger * booking.passenger_count;

                await db.query(
                    'UPDATE miles_members SET total_points = total_points + @points WHERE id = @id',
                    { points: totalPoints, id: booking.m_id }
                );

                await db.query(
                    `INSERT INTO miles_ledger (member_id, transaction_type, points, description, flight_id, booking_id, source)
                     VALUES (@mid, 'EARNED', @points, @desc, @fid, @bid, 'Flight Completion')`,
                    {
                        mid: booking.m_id,
                        points: totalPoints,
                        desc: `Earned from flight booking ${booking.booking_reference}`,
                        fid: flight.id,
                        bid: booking.id
                    }
                );

                totalBookingsProcessed++;
                totalPointsAwarded += totalPoints;

                // Send notification
                await sendToQueue(QUEUES.POINTS_NOTIFICATION, {
                    email: booking.email,
                    first_name: booking.first_name,
                    points_earned: totalPoints,
                    new_total: booking.total_points + totalPoints
                });
            }

            // Uçuşu "işlendi" olarak işaretle
            await db.query(
                `INSERT INTO processed_flight_miles (flight_id, bookings_processed, points_awarded) VALUES (@fid, @bp, @pa)`,
                { fid: flight.id, bp: bookings.length, pa: bookings.reduce((sum, b) => sum + (pointsPerPassenger * b.passenger_count), 0) }
            );
        }

        console.log(`✅ Nightly processing complete: processed ${completedFlights.length} flights`);

    } catch (error) {
        console.error('Error in nightly processing:', error);
    }
};

// Gece 2'de çalışacak şekilde ayarla (Cron job)
cron.schedule('0 2 * * *', () => {
    processCompletedFlights();
});

// Manual trigger endpoint for testing
app.post('/api/v1/miles/process-flights', requireServiceAuth, async (req, res) => {
    await processCompletedFlights();
    res.json({ message: 'Nightly processing triggered' });
});

app.listen(PORT, () => {
    console.log(`🎯 Miles Service using Azure SQL & Cognito running on port ${PORT}`);
});
