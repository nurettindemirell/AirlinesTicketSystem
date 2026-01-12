require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// EMAIL AYARLARI (Gmail SMTP kullanıyoruz)
// ============================================
let emailConfigured = false;

const transporter = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        },
        connectionTimeout: 5000, // 5 second connection timeout
        greetingTimeout: 5000,   // 5 second greeting timeout
        socketTimeout: 10000     // 10 second socket timeout
    })
    : null;

// Başlangıçta mail ayarlarını kontrol et (zaman aşımıyla birlikte)
const verifyEmail = async () => {
    if (!transporter) {
        console.log('⚠️  Email not configured - GMAIL_USER or GMAIL_APP_PASSWORD missing');
        return;
    }

    try {
        const verifyPromise = new Promise((resolve, reject) => {
            transporter.verify((error, success) => {
                if (error) reject(error);
                else resolve(success);
            });
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Email verification timeout (5s)')), 5000)
        );

        await Promise.race([verifyPromise, timeoutPromise]);
        emailConfigured = true;
        console.log('✅ Email server is ready to send messages');
    } catch (error) {
        console.log('⚠️  Email configuration error:', error.message);
        console.log('   Email functionality may not work.');
    }
};

// Mail kontrolünü başlat (bekletme yapmaz, non-blocking)
setImmediate(verifyEmail);

// ============================================
// RABBITMQ AYARLARI (Mesaj kuyruğu)
// ============================================
let rabbitChannel = null;
let rabbitRetryCount = 0;
const MAX_RABBIT_RETRIES = 5;
const RABBIT_CONNECT_TIMEOUT = 5000; // 5 seconds

const QUEUES = {
    WELCOME_EMAIL: 'welcome_email_queue',
    POINTS_NOTIFICATION: 'points_notification_queue',
    BOOKING_CONFIRMATION: 'booking_confirmation_queue',
    MEMBER_INVITE: 'member_invite_queue'
};

const connectRabbitMQ = async () => {
    try {
        if (!process.env.RABBITMQ_URL) {
            console.log('⚠️  RABBITMQ_URL not configured - queue functionality disabled');
            return;
        }

        if (rabbitRetryCount >= MAX_RABBIT_RETRIES) {
            console.log(`⚠️  RabbitMQ max retries (${MAX_RABBIT_RETRIES}) reached. Queue functionality disabled.`);
            console.log('   Restart the service to try again.');
            return;
        }

        rabbitRetryCount++;
        console.log(`🔄 RabbitMQ connection attempt ${rabbitRetryCount}/${MAX_RABBIT_RETRIES}...`);

        // Bağlantı zaman aşımı ekle
        const connectPromise = amqp.connect(process.env.RABBITMQ_URL);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout')), RABBIT_CONNECT_TIMEOUT)
        );

        const connection = await Promise.race([connectPromise, timeoutPromise]);
        rabbitChannel = await connection.createChannel();

        // Declare queues
        await rabbitChannel.assertQueue(QUEUES.WELCOME_EMAIL, { durable: true });
        await rabbitChannel.assertQueue(QUEUES.POINTS_NOTIFICATION, { durable: true });
        await rabbitChannel.assertQueue(QUEUES.BOOKING_CONFIRMATION, { durable: true });
        await rabbitChannel.assertQueue(QUEUES.MEMBER_INVITE, { durable: true });

        console.log('✅ Connected to RabbitMQ');
        rabbitRetryCount = 0; // Reset on successful connection

        // Start consuming messages
        startConsumers();

        connection.on('error', (err) => {
            console.error('RabbitMQ connection error:', err.message);
            rabbitChannel = null;
            if (rabbitRetryCount < MAX_RABBIT_RETRIES) {
                setTimeout(connectRabbitMQ, 5000);
            }
        });

        connection.on('close', () => {
            console.log('RabbitMQ connection closed');
            rabbitChannel = null;
            if (rabbitRetryCount < MAX_RABBIT_RETRIES) {
                setTimeout(connectRabbitMQ, 5000);
            }
        });

    } catch (error) {
        console.log('⚠️  RabbitMQ connection failed:', error.message);
        rabbitChannel = null;

        if (rabbitRetryCount < MAX_RABBIT_RETRIES) {
            const retryDelay = Math.min(10000, 2000 * rabbitRetryCount); // Exponential backoff, max 10s
            console.log(`   Retrying in ${retryDelay / 1000} seconds... (${rabbitRetryCount}/${MAX_RABBIT_RETRIES})`);
            setTimeout(connectRabbitMQ, retryDelay);
        } else {
            console.log('   Max retries reached. Queue functionality disabled.');
        }
    }
};

// ============================================
// EMAIL SENDING FUNCTIONS
// ============================================

const sendWelcomeEmail = async (member) => {
    const mailOptions = {
        from: `"Fly with Bilet" <${process.env.GMAIL_USER}>`,
        to: member.email,
        subject: '✈️ Welcome to Fly with Bilet!',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 12px; color: white;">
          <h1 style="margin: 0; font-size: 28px;">✈️ Hoş Geldiniz!</h1>
        </div>
        <div style="background: white; padding: 30px; border-radius: 12px; margin-top: 20px;">
          <h2 style="color: #1e293b;">Merhaba ${member.first_name}!</h2>
         <p style="color: #64748b; line-height: 1.8;">Fly with Bilet ailesine katıldığınız için teşekkürler! 🎉</p>
          
          <div style="background: #f1f5f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #475569;"><strong>Üyelik Numaranız:</strong> ${member.member_number}</p>
            <p style="margin: 10px 0 0 0; color: #475569;"><strong>Puanlarınız:</strong> ${member.total_points || 0} miles</p>
          </div>

          <p style="color: #64748b;">Artık her uçuşta puan kazanabilir ve bu puanlarla ücretsiz uçuş yapabilirsiniz!</p>
          
          <div style="text-align: center; margin-top: 30px;">
            <a href="http://localhost:5174/miles" style="background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600;">Profilimi Görüntüle</a>
          </div>
        </div>
        <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 14px;">
          <p>© 2026 Fly with Bilet</p>
        </div>
      </div>
    `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Welcome email sent to ${member.email}`);
        return true;
    } catch (error) {
        console.error('Failed to send welcome email:', error);
        return false;
    }
};

const sendInviteEmail = async (candidate) => {
    const mailOptions = {
        from: `"Fly with Bilet" <${process.env.GMAIL_USER}>`,
        to: candidate.email,
        subject: '✨ Ücretsiz Üyelik Davetiniz!',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 12px; color: white;">
          <h1 style="margin: 0;">✨ Özel Davet!</h1>
        </div>
        <div style="background: white; padding: 30px; border-radius: 12px; margin-top: 20px;">
          <h2 style="color: #1e293b;">Merhaba ${candidate.first_name}!</h2>
          <p style="color: #64748b; line-height: 1.8;">Biletinizi aldığınız için teşekkürler! 🎫</p>
          <p style="color: #64748b; line-height: 1.8;">Küçük bir hatırlatma: <strong>Üye olarak uçarsanız puan kazanabilirsiniz!</strong></p>
          
          <div style="background: #f1f5f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #475569; font-weight: 600;">Üye Olmanın Avantajları:</p>
            <ul style="color: #475569; margin: 10px 0;">
              <li>Her uçuşta puan kazan</li>
              <li>Puanlarla ücretsiz uç</li>
              <li>Öncelikli işlemler</li>
            </ul>
          </div>

          <div style="text-align: center; margin-top: 30px;">
            <a href="http://localhost:5174/miles" style="background: #3b82f6; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600;">Hemen Üye Ol</a>
          </div>
          
          <p style="margin-top: 30px; font-size: 14px; color: #94a3b8; text-align: center;">Sadece 1 dakika sürüyor!</p>
        </div>
        <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 14px;">
          <p>© 2026 Fly with Bilet</p>
        </div>
      </div>
    `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Invite email sent to ${candidate.email}`);
        return true;
    } catch (error) {
        console.error('Failed to send invite email:', error);
        return false;
    }
};

const sendPointsNotificationEmail = async (member) => {
    const mailOptions = {
        from: `"Flight System" <${process.env.GMAIL_USER}>`,
        to: member.email,
        subject: '🎉 You earned MilesSmiles points!',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">🎉 Points Earned!</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Great news, ${member.first_name}!</h2>
          <p>Your recent flight has earned you MilesSmiles points!</p>
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <h3 style="color: #11998e; font-size: 24px;">+${member.points_earned} Points</h3>
            <p><strong>New Total:</strong> ${member.new_total} points</p>
          </div>
          <p>Keep flying to earn more rewards!</p>
        </div>
        <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
          <p>© 2026 Fly with Bilet</p>
        </div>
      </div>
    `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Points notification sent to ${member.email}`);
        return true;
    } catch (error) {
        console.error('Failed to send points notification:', error);
        return false;
    }
};


const sendBookingConfirmationEmail = async (booking) => {
    try {
        const {
            contact_email,
            booking_reference,
            flight_number,
            origin,
            origin_city,
            destination,
            destination_city,
            departure_time,
            passengers,
            passenger_names,
            total_price,
            is_connecting
        } = booking;

        const depDate = new Date(departure_time);
        const formattedDate = depDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const formattedTime = depDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        // Build route display with city names
        const originDisplay = origin_city ? `${origin} (${origin_city})` : origin;
        const destDisplay = destination_city ? `${destination} (${destination_city})` : destination;
        const routeDisplay = `${originDisplay} → ${destDisplay}`;

        // Build passenger list HTML
        let passengerListHtml = '';
        if (passenger_names && Array.isArray(passenger_names) && passenger_names.length > 0) {
            passengerListHtml = `
                <h3 style="margin-top: 25px;">👥 Passengers</h3>
                <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <ul style="margin: 0; padding-left: 20px;">
                        ${passenger_names.map((name, index) =>
                `<li style="padding: 5px 0;"><strong>Passenger ${index + 1}:</strong> ${name}</li>`
            ).join('')}
                    </ul>
                </div>
            `;
        }

        // Connection badge for connecting flights
        const connectionBadge = is_connecting
            ? '<span style="background: #f59e0b; color: white; padding: 4px 10px; border-radius: 15px; font-size: 12px; margin-left: 10px;">Connecting Flight</span>'
            : '';

        const mailOptions = {
            from: `"FlightSystem" <${process.env.GMAIL_USER}>`,
            to: contact_email,
            subject: `✈️ Booking Confirmed - ${booking_reference}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: linear-gradient(135deg, #1e40af 0%, #7c3aed 100%); padding: 30px; text-align: center; color: white;">
                        <h1 style="margin: 0;">✈️ Booking Confirmed!</h1>
                    </div>
                    <div style="padding: 30px; background: #f8fafc;">
                        <h2 style="color: #1e40af;">Your Booking Reference</h2>
                        <div style="background: #fef3c7; padding: 20px; border-radius: 10px; text-align: center; margin: 20px 0;">
                            <span style="font-size: 32px; font-weight: bold; color: #d97706;">${booking_reference}</span>
                        </div>
                        
                        <h3>✈️ Flight Details ${connectionBadge}</h3>
                        <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px;">
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; width: 35%;"><strong>Flight</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${flight_number || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;"><strong>Route</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #1e40af;">${routeDisplay}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;"><strong>Date</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${formattedDate}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;"><strong>Time</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${formattedTime}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;"><strong>Passengers</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${passengers} passenger(s)</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px;"><strong>Total Price</strong></td>
                                <td style="padding: 12px; font-size: 20px; color: #059669; font-weight: bold;">$${parseFloat(total_price).toFixed(2)}</td>
                            </tr>
                        </table>
                        
                        ${passengerListHtml}
                        
                        <div style="margin-top: 30px; padding: 15px; background: #eff6ff; border-radius: 8px; border-left: 4px solid #3b82f6;">
                            <p style="margin: 0; color: #1e40af;"><strong>📌 Important:</strong></p>
                            <p style="margin: 10px 0 0 0; color: #64748b;">Please arrive at the airport at least 2 hours before domestic flights and 3 hours before international flights.</p>
                        </div>
                        
                        <p style="margin-top: 25px; color: #64748b; text-align: center;">Thank you for choosing Fly with Bilet! ✈️</p>
                    </div>
                    <div style="background: #1e293b; color: white; padding: 20px; text-align: center; font-size: 12px;">
                        <p style="margin: 0;">© 2026 Fly with Bilet</p>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log('📧 Booking confirmation email sent to', contact_email);
        return true;
    } catch (error) {
        console.error('Failed to send booking confirmation:', error);
        return false;
    }
};

// ============================================
// QUEUE CONSUMERS
// ============================================

const startConsumers = () => {
    if (!rabbitChannel) return;

    // Welcome email consumer
    rabbitChannel.consume(QUEUES.WELCOME_EMAIL, async (msg) => {
        if (msg) {
            try {
                const member = JSON.parse(msg.content.toString());
                console.log('📨 Processing welcome email for:', member.email);
                await sendWelcomeEmail(member);
                rabbitChannel.ack(msg);
            } catch (error) {
                console.error('Error processing welcome email:', error);
                rabbitChannel.nack(msg, false, true); // Requeue
            }
        }
    });

    // Points notification consumer
    rabbitChannel.consume(QUEUES.POINTS_NOTIFICATION, async (msg) => {
        if (msg) {
            try {
                const member = JSON.parse(msg.content.toString());
                console.log('📨 Processing points notification for:', member.email);
                await sendPointsNotificationEmail(member);
                rabbitChannel.ack(msg);
            } catch (error) {
                console.error('Error processing points notification:', error);
                rabbitChannel.nack(msg, false, true); // Requeue
            }
        }
    });

    // Booking confirmation consumer
    rabbitChannel.consume(QUEUES.BOOKING_CONFIRMATION, async (msg) => {
        if (msg) {
            try {
                const booking = JSON.parse(msg.content.toString());
                console.log('📨 Processing booking confirmation for:', booking.contact_email);
                await sendBookingConfirmationEmail(booking);
                rabbitChannel.ack(msg);
            } catch (error) {
                console.error('Error processing booking confirmation:', error);
                rabbitChannel.nack(msg, false, true);
            }
        }
    });

    // Member Invite consumer
    rabbitChannel.consume(QUEUES.MEMBER_INVITE, async (msg) => {
        if (msg) {
            try {
                const candidate = JSON.parse(msg.content.toString());
                console.log('📨 Processing member invite for:', candidate.email);
                await sendInviteEmail(candidate);
                rabbitChannel.ack(msg);
            } catch (error) {
                console.error('Error processing member invite:', error);
                rabbitChannel.nack(msg, false, true);
            }
        }
    });

    console.log('📬 Queue consumers started');
};

// ============================================
// HEALTH ENDPOINTS
// ============================================
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'notification-service',
        timestamp: new Date().toISOString(),
        email_configured: !!process.env.GMAIL_USER,
        rabbitmq_connected: !!rabbitChannel
    });
});

app.get('/api/v1/notifications/health', (req, res) => {
    res.json({
        status: 'ok',
        endpoint: 'notifications',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// API ENDPOINTS (for internal service calls)
// ============================================

// POST /api/v1/notifications/welcome - Queue welcome email
app.post('/api/v1/notifications/welcome', async (req, res) => {
    try {
        const { member } = req.body;

        if (!member || !member.email) {
            return res.status(400).json({ error: 'Member data with email required' });
        }

        if (rabbitChannel) {
            // Queue the message
            rabbitChannel.sendToQueue(
                QUEUES.WELCOME_EMAIL,
                Buffer.from(JSON.stringify(member)),
                { persistent: true }
            );
            console.log('📤 Welcome email queued for:', member.email);
            res.json({ message: 'Welcome email queued', queued: true });
        } else {
            // Fallback: send directly if queue not available
            console.log('⚠️  Queue not available, sending directly...');
            await sendWelcomeEmail(member);
            res.json({ message: 'Welcome email sent directly', queued: false });
        }

    } catch (error) {
        console.error('Error queuing welcome email:', error);
        res.status(500).json({ error: 'Failed to queue email' });
    }
});

// POST /api/v1/notifications/points - Queue points notification
app.post('/api/v1/notifications/points', async (req, res) => {
    try {
        const { member } = req.body;

        if (!member || !member.email) {
            return res.status(400).json({ error: 'Member data with email required' });
        }

        if (rabbitChannel) {
            rabbitChannel.sendToQueue(
                QUEUES.POINTS_NOTIFICATION,
                Buffer.from(JSON.stringify(member)),
                { persistent: true }
            );
            console.log('📤 Points notification queued for:', member.email);
            res.json({ message: 'Points notification queued', queued: true });
        } else {
            await sendPointsNotificationEmail(member);
            res.json({ message: 'Points notification sent directly', queued: false });
        }

    } catch (error) {
        console.error('Error queuing points notification:', error);
        res.status(500).json({ error: 'Failed to queue notification' });
    }
});

// POST /api/v1/notifications/test - Send a test email (for verification)
app.post('/api/v1/notifications/test', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email address required' });
        }

        const mailOptions = {
            from: `"Flight System Test" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: '🧪 Test Email - Flight System',
            text: 'This is a test email from the SE4458 Flight System notification service.',
            html: '<h1>Test Email</h1><p>This is a test email from the SE4458 Flight System notification service.</p>'
        };

        await transporter.sendMail(mailOptions);
        console.log(`📧 Test email sent to ${email}`);
        res.json({ message: 'Test email sent successfully' });

    } catch (error) {
        console.error('Failed to send test email:', error);
        res.status(500).json({ error: 'Failed to send test email', details: error.message });
    }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`📧 Notification Service running on http://localhost:${PORT}`);

    // Connect to RabbitMQ
    if (process.env.RABBITMQ_URL) {
        connectRabbitMQ();
    } else {
        console.log('⚠️  RABBITMQ_URL not configured - queue functionality disabled');
    }
});
