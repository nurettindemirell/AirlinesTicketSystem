require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { requireAuth, requireRole, optionalAuth, ROLES } = require('./middleware/auth');
const db = require('./utils/db');
const cache = require('./config/cache');
const { predictPrice } = require('./ml/pricePredictor');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 3001;

// RabbitMQ bağlantısı (Mesajlaşma için)
let rabbitChannel = null;
let rabbitRetryCount = 0;
const MAX_RABBIT_RETRIES = 5;
const RABBIT_CONNECT_TIMEOUT = 5000; // 5 seconds
const BOOKING_QUEUE = 'booking_confirmation_queue';
const INVITE_QUEUE = 'member_invite_queue';

const connectRabbitMQ = async () => {
    try {
        if (!process.env.RABBITMQ_URL) {
            console.log('⚠️  RABBITMQ_URL not configured - booking emails disabled');
            return;
        }

        if (rabbitRetryCount >= MAX_RABBIT_RETRIES) {
            console.log(`⚠️  RabbitMQ max retries (${MAX_RABBIT_RETRIES}) reached. Booking emails disabled.`);
            return;
        }

        rabbitRetryCount++;
        console.log(`🔄 RabbitMQ connection attempt ${rabbitRetryCount}/${MAX_RABBIT_RETRIES}...`);

        // Bağlantı zaman aşımı süresi ekle
        const connectPromise = amqp.connect(process.env.RABBITMQ_URL);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout')), RABBIT_CONNECT_TIMEOUT)
        );

        const connection = await Promise.race([connectPromise, timeoutPromise]);
        rabbitChannel = await connection.createChannel();
        await rabbitChannel.assertQueue(BOOKING_QUEUE, { durable: true });
        await rabbitChannel.assertQueue(INVITE_QUEUE, { durable: true });
        console.log('✅ Connected to RabbitMQ for booking notifications');
        rabbitRetryCount = 0; // Reset on success

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
            const retryDelay = Math.min(10000, 2000 * rabbitRetryCount);
            console.log(`   Retrying in ${retryDelay / 1000} seconds... (${rabbitRetryCount}/${MAX_RABBIT_RETRIES})`);
            setTimeout(connectRabbitMQ, retryDelay);
        }
    }
};

const queueBookingEmail = (booking) => {
    if (!rabbitChannel) return false;
    try {
        rabbitChannel.sendToQueue(BOOKING_QUEUE, Buffer.from(JSON.stringify(booking)), { persistent: true });
        console.log('📤 Booking confirmation queued for:', booking.contact_email);
        return true;
    } catch (err) {
        console.error('Failed to queue booking email:', err);
        return false;
    }
};

const queueInviteEmail = (candidate) => {
    if (!rabbitChannel) return false;
    try {
        rabbitChannel.sendToQueue(INVITE_QUEUE, Buffer.from(JSON.stringify(candidate)), { persistent: true });
        console.log('📤 Member invite queued for:', candidate.email);
        return true;
    } catch (err) {
        console.error('Failed to queue invite email:', err);
        return false;
    }
};

// RabbitMQ'yu başlat (bekletme yapmaz, non-blocking)
setImmediate(connectRabbitMQ);

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// HEALTH ENDPOINTS
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'flight-service', timestamp: new Date().toISOString() });
});

app.get('/api/v1/admin/health', (req, res) => {
    res.json({ status: 'ok', endpoint: 'admin', timestamp: new Date().toISOString() });
});

app.get('/api/v1/flights/health', (req, res) => {
    res.json({ status: 'ok', endpoint: 'flights', timestamp: new Date().toISOString() });
});

app.get('/api/v1/tickets/health', (req, res) => {
    res.json({ status: 'ok', endpoint: 'tickets', timestamp: new Date().toISOString() });
});

// ============================================
// ADMIN ENDPOINTS (TEMPORARY: Auth disabled for testing)
// ============================================

// POST /api/v1/admin/flights - Yeni uçuş ekle (GEÇİCİ: Auth kapalı test için)
app.post('/api/v1/admin/flights', async (req, res) => {
    try {
        const {
            flight_number,
            origin_airport_code,
            destination_airport_code,
            departure_time,
            arrival_time,
            total_capacity,
            base_price,
            is_direct = true
        } = req.body;

        // Gerekli alanları doğrula
        if (!flight_number || !origin_airport_code || !destination_airport_code ||
            !departure_time || !arrival_time || !total_capacity || !base_price) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Uçuş numarası formatını kontrol et (örn: TK123)
        if (!/^[A-Z]{2}\d{1,4}$/i.test(flight_number)) {
            return res.status(400).json({ error: 'Invalid flight number format. Expected format: XX123 (e.g., TK123)' });
        }

        // Kalkış ve varış havaalanlarının farklı olduğunu doğrula
        if (origin_airport_code.toUpperCase() === destination_airport_code.toUpperCase()) {
            return res.status(400).json({ error: 'Origin and destination airports must be different' });
        }

        // Kapasite kontrolü
        const capacity = parseInt(total_capacity);
        if (isNaN(capacity) || capacity <= 0 || capacity > 1000) {
            return res.status(400).json({ error: 'Total capacity must be between 1 and 1000' });
        }

        // Fiyat kontrolü
        const price = parseFloat(base_price);
        if (isNaN(price) || price <= 0) {
            return res.status(400).json({ error: 'Base price must be a positive number' });
        }

        // Havalimanı ID'lerini al
        const { data: originAirport, error: originError } = await db.querySingle(
            `SELECT id FROM airports WHERE code = @code`,
            { code: origin_airport_code.toUpperCase() }
        );

        const { data: destAirport, error: destError } = await db.querySingle(
            `SELECT id FROM airports WHERE code = @code`,
            { code: destination_airport_code.toUpperCase() }
        );

        if (originError || !originAirport) {
            return res.status(400).json({ error: `Origin airport not found: ${origin_airport_code}` });
        }

        if (destError || !destAirport) {
            return res.status(400).json({ error: `Destination airport not found: ${destination_airport_code}` });
        }

        // Süreyi dakika cinsinden hesapla
        const depTime = new Date(departure_time);
        const arrTime = new Date(arrival_time);
        const duration_minutes = Math.round((arrTime - depTime) / (1000 * 60));

        if (duration_minutes <= 0) {
            return res.status(400).json({ error: 'Arrival time must be after departure time' });
        }

        const predicted_price = base_price; // Placeholder

        // Insert flight
        const insertQuery = `
            INSERT INTO flights (
                flight_number, origin_airport_id, destination_airport_id, 
                departure_time, arrival_time, duration_minutes, 
                total_capacity, available_capacity, base_price, 
                predicted_price, is_direct, status
            )
            OUTPUT INSERTED.*
            VALUES (
                @flight_number, @origin_id, @dest_id, 
                @dep_time, @arr_time, @duration, 
                @capacity, @capacity, @price, 
                @predicted, @is_direct, 'SCHEDULED'
            )
        `;

        const { data: insertedFlight, error: insertError } = await db.querySingle(insertQuery, {
            flight_number,
            origin_id: originAirport.id,
            dest_id: destAirport.id,
            dep_time: depTime,
            arr_time: arrTime,
            duration: duration_minutes,
            capacity,
            price,
            predicted: predicted_price,
            is_direct: is_direct ? 1 : 0
        });

        if (insertError) {
            console.error('Insert error:', insertError);
            return res.status(500).json({ error: 'Failed to create flight', details: insertError.message });
        }

        // Yeni uçuş eklenince arama önbelleğini (cache) temizle
        await cache.delByPattern('cache:search:*');
        console.log('🗑️  Search cache invalidated after new flight added');

        res.status(201).json({
            message: 'Flight created successfully',
            flight: {
                ...insertedFlight,
                origin_airport_code,
                destination_airport_code
            }
        });

    } catch (error) {
        console.error('Error creating flight:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/admin/flights - List all flights (TEMP: Auth bypassed)
app.get('/api/v1/admin/flights', async (req, res) => {
    try {
        const { page = 1, limit = 1000 } = req.query;
        const offset = (page - 1) * limit;

        // Tabloları birleştirmek için özel sorgu
        const queryText = `
            SELECT 
                f.id, f.flight_number, f.origin_airport_id, f.destination_airport_id,
                f.departure_time, f.arrival_time, f.duration_minutes, 
                f.total_capacity, f.available_capacity, f.base_price, 
                f.predicted_price, f.is_direct, f.status, f.created_at,
                oa.code as origin_code, oa.name as origin_name, oa.city as origin_city,
                da.code as dest_code, da.name as dest_name, da.city as dest_city
            FROM flights f
            JOIN airports oa ON f.origin_airport_id = oa.id
            JOIN airports da ON f.destination_airport_id = da.id
            ORDER BY f.departure_time ASC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        const countQuery = `SELECT COUNT(*) as count FROM flights`;

        const { data: rawFlights, error } = await db.query(queryText, {
            offset: parseInt(offset),
            limit: parseInt(limit)
        });

        const { data: countResult } = await db.querySingle(countQuery);
        const count = countResult ? countResult.count : 0;

        if (error) {
            console.error('❌ Error fetching flights:', error);
            return res.status(500).json({ error: 'Failed to fetch flights', details: error.message });
        }

        // Transform flat result to nested object
        const flights = rawFlights.map(f => ({
            ...f,
            origin: { code: f.origin_code, name: f.origin_name, city: f.origin_city },
            destination: { code: f.dest_code, name: f.dest_name, city: f.dest_city },
            origin_code: undefined, origin_name: undefined, origin_city: undefined,
            dest_code: undefined, dest_name: undefined, dest_city: undefined
        }));

        console.log(`📊 Admin flights query: Found ${count} total flights, returning ${flights.length} flights`);

        // Admin uçuş listesi için önbelleği kapat
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        res.json({
            flights,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        });

    } catch (error) {
        console.error('Error fetching flights:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/v1/admin/predict-price - ML price prediction (TEMP: Auth bypassed)
app.post('/api/v1/admin/predict-price', async (req, res) => {
    try {
        const {
            origin_airport_code,
            destination_airport_code,
            departure_time,
            duration_minutes,
            is_direct = true,
            base_price = null
        } = req.body;

        if (!origin_airport_code || !destination_airport_code || !departure_time || !duration_minutes) {
            return res.status(400).json({
                error: 'Missing required fields'
            });
        }

        const duration = parseInt(duration_minutes);
        let prediction;
        try {
            prediction = predictPrice({
                durationMinutes: duration,
                departureTime: departure_time,
                isDirect: is_direct,
                originCode: origin_airport_code.toUpperCase(),
                destinationCode: destination_airport_code.toUpperCase(),
                basePrice: base_price ? parseFloat(base_price) : null
            });
        } catch (predictionError) {
            return res.status(400).json({
                error: 'Prediction calculation failed',
                details: predictionError.message
            });
        }

        res.json({
            message: 'Price prediction successful',
            prediction
        });

    } catch (error) {
        console.error('Error predicting price:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// PUBLIC FLIGHT ENDPOINTS
// ============================================

// GET /api/v1/flights/airports - Get all airports
app.get('/api/v1/flights/airports', async (req, res) => {
    try {
        const cacheKey = cache.CACHE_KEYS.AIRPORTS;
        const cachedAirports = await cache.get(cacheKey);

        if (cachedAirports) {
            return res.json({ airports: cachedAirports, cached: true, cacheType: 'redis' });
        }

        const { data: airports, error } = await db.query(
            'SELECT id, code, name, city, country FROM airports ORDER BY city ASC'
        );

        if (error) {
            return res.status(500).json({ error: 'Failed to fetch airports' });
        }

        await cache.set(cacheKey, airports, 600);
        res.json({ airports, cached: false });

    } catch (error) {
        console.error('Error fetching airports:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/flights/cache-stats - Get cache statistics
app.get('/api/v1/flights/cache-stats', async (req, res) => {
    const stats = await cache.getStats();
    res.json({
        stats,
        redisConnected: cache.isReady(),
        message: 'Redis cache statistics'
    });
});

// GET /api/v1/flights/search - Search flights (public)
app.get('/api/v1/flights/search', optionalAuth, async (req, res) => {
    try {
        const {
            from, to, date, start_date, end_date,
            passengers = 1, flexible = false, direct_only = false,
            page = 1, limit = 100
        } = req.query;

        if (!from || !to) {
            return res.status(400).json({ error: 'Missing required parameters: from, to' });
        }

        const passengerCount = parseInt(passengers);
        const offset = (page - 1) * limit;
        let startDate, endDate;

        // Tarih formatı düzenleme mantığı
        try {
            if (start_date && end_date) {
                // ... (Keep existing date logic parsing) ...
                let startDateStr = start_date;
                let endDateStr = end_date;
                if (start_date.includes('.')) startDateStr = start_date.split('.').reverse().join('-');
                if (end_date.includes('.')) endDateStr = end_date.split('.').reverse().join('-');

                startDate = new Date(startDateStr);
                endDate = new Date(endDateStr);
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(23, 59, 59, 999);
            } else if (date) {
                let dateStr = date;
                if (date.includes('.')) dateStr = date.split('.').reverse().join('-');
                const searchDate = new Date(dateStr);

                if (flexible === 'true') {
                    startDate = new Date(searchDate);
                    startDate.setDate(startDate.getDate() - 3);
                    endDate = new Date(searchDate);
                    endDate.setDate(endDate.getDate() + 3);
                } else {
                    startDate = new Date(searchDate);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(searchDate);
                    endDate.setHours(23, 59, 59, 999);
                }
            } else {
                return res.status(400).json({ error: 'Missing date parameters' });
            }
        } catch (err) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Önbellek (Cache) Kontrolü
        const cacheKey = cache.CACHE_KEYS.FLIGHT_SEARCH({
            from: from.toUpperCase(), to: to.toUpperCase(),
            date: start_date && end_date ? `${start_date}_${end_date}` : date,
            passengers: passengerCount, flexible, direct_only, page, limit
        });
        const cachedResult = await cache.get(cacheKey);
        if (cachedResult) return res.json({ ...cachedResult, cached: true, cacheType: 'redis' });

        // Havalimanı bilgilerini getir
        const { data: apiAirports, error: airportError } = await db.query(
            `SELECT id, code, city FROM airports WHERE code IN (@from, @to)`,
            { from: from.toUpperCase(), to: to.toUpperCase() }
        );

        if (airportError || !apiAirports || apiAirports.length < 2) {
            // Handle case where one or both airports are missing
            return res.status(400).json({ error: 'Airports not found' });
        }

        const originAirport = apiAirports.find(a => a.code === from.toUpperCase());
        const destAirport = apiAirports.find(a => a.code === to.toUpperCase());

        // Base Query
        let sql = `
            SELECT 
                f.*,
                oa.code as origin_code, oa.name as origin_name, oa.city as origin_city,
                da.code as dest_code, da.name as dest_name, da.city as dest_city
            FROM flights f
            JOIN airports oa ON f.origin_airport_id = oa.id
            JOIN airports da ON f.destination_airport_id = da.id
            WHERE f.origin_airport_id = @origin_id
            AND f.destination_airport_id = @dest_id
            AND f.departure_time >= @start_date
            AND f.departure_time <= @end_date
            AND f.available_capacity >= @passengers
            AND f.status = 'SCHEDULED'
        `;

        if (direct_only === 'true') {
            sql += ` AND f.is_direct = 1`;
        }

        sql += ` ORDER BY f.departure_time ASC`;

        const { data: directFlights, error: directError } = await db.query(sql, {
            origin_id: originAirport.id,
            dest_id: destAirport.id,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            passengers: passengerCount
        });

        if (directError) throw new Error(directError.message);

        let allFlights = directFlights.map(f => ({
            ...f,
            origin: { code: f.origin_code, name: f.origin_name, city: f.origin_city },
            destination: { code: f.dest_code, name: f.dest_name, city: f.dest_city },
            is_direct: !!f.is_direct
        }));

        // Aktarmalı uçuş mantığı (SQL için basitleştirildi - şimdilik sadece direkt uçuşlar)
        // Would need a self-join or recursive CTE for connecting flights in SQL.

        // Sayfalama (Pagination)
        const totalCount = allFlights.length;
        const paginatedFlights = allFlights.slice(offset, offset + parseInt(limit));

        const result = {
            flights: paginatedFlights,
            search_params: { from, to, date, passengers: passengerCount, flexible, direct_only },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                totalPages: Math.ceil(totalCount / parseInt(limit))
            }
        };

        await cache.set(cacheKey, result, 120);
        res.json({ ...result, cached: false });

    } catch (error) {
        console.error('Error searching flights:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// BOOKING ENDPOINTS
// ============================================

// POST /api/v1/bookings - Create new booking
app.post('/api/v1/bookings', optionalAuth, async (req, res) => {
    // Transaction support is tricky with simple tedious helper. 
    // Ideally we use a transaction object. 
    // Since our db helper doesn't expose transaction support easily, we will do sequential ops 
    // and rely on capacity check.
    // NOTE: For critical systems, genuine SQL Transactions are required to prevent race conditions (Overbooking).
    // Given the constraints and existing helper, we will attempt to be as atomic as possible.

    // Daha iyi yaklaşım: Kapasite ve ekleme için saklı yordam (Stored Procedure) kullanmak.

    try {
        const {
            flight_id,
            passenger_count = 1,
            passenger_details, // { first_name, last_name, email, phone, dob, is_member_request }
            payment_method = 'MONEY', // 'MONEY' or 'MILES'
            miles_member_id // If paying with miles or linking
        } = req.body;

        if (!flight_id || !passenger_details || !passenger_details.email || !passenger_details.first_name || !passenger_details.last_name) {
            return res.status(400).json({ error: 'Missing required booking details' });
        }

        // 1. Uçuşu Getir & Kapasiteyi Kontrol Et (mail için havalimanı bilgisiyle)
        const { data: flight, error: flightError } = await db.querySingle(`
            SELECT f.*, 
                   oa.code as origin_code, oa.city as origin_city,
                   da.code as dest_code, da.city as dest_city
            FROM flights f
            JOIN airports oa ON f.origin_airport_id = oa.id
            JOIN airports da ON f.destination_airport_id = da.id
            WHERE f.id = @id
        `, { id: flight_id });

        if (flightError || !flight) return res.status(404).json({ error: 'Flight not found' });

        if (flight.available_capacity < passenger_count) {
            return res.status(400).json({ error: 'Not enough seats available' });
        }

        const totalPrice = flight.base_price * passenger_count;
        const totalMiles = (flight.duration_minutes * 10) * passenger_count; // Example: 10 points per minute cost? No, usually miles price is different.
        // Let's assume Price * 100 for points cost for simplicity
        const milesCost = totalPrice * 10;

        // 2. Ödeme İşlemleri
        if (payment_method === 'MILES') {
            if (!miles_member_id) return res.status(400).json({ error: 'Member ID required for miles payment' });

            // Mil Servisini çağır (Redeem)
            // Need service-to-service auth token (use simplified approach for demo: shared secret or just assume trust in internal network)
            // We implemented `requireServiceAuth` which checks `x-service-key`.
            // Let's assume we pass that header.

            const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

            const redeemRes = await fetch(`${process.env.MILES_SERVICE_URL || 'http://localhost:3002'}/api/v1/miles/redeem`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-service-key': process.env.SERVICE_KEY || 'my-secret-service-key'
                },
                body: JSON.stringify({
                    member_id: miles_member_id,
                    points: milesCost,
                    description: `Flight Booking ${flight.flight_number}`,
                    flight_id: flight.id
                })
            });

            if (!redeemRes.ok) {
                const errData = await redeemRes.json();
                return res.status(400).json({ error: 'Payment failed: ' + (errData.error || 'Unknown error') });
            }
        }

        // 3. Üye Oluştur (İstek varsa - Davet Akışı)
        let finalMemberId = miles_member_id;
        if (passenger_details.is_member_request && !miles_member_id) {
            try {
                queueInviteEmail({
                    email: passenger_details.email,
                    first_name: passenger_details.first_name,
                    last_name: passenger_details.last_name
                });
                console.log('?? New Member Invite Queued for:', passenger_details.email);
            } catch (e) {
                console.error('Failed to queue member invite', e);
            }
        }

        // 4. ATOMİK AZALTMA & EKLEME (Transaction benzeri yapı)
        const bookingRef = 'BK' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

        // Kapasiteyi yazma anında tekrar kontrol eden güvenli bir UPDATE sorgusu kullanıyoruz
        const updateResult = await db.querySingle(`
            UPDATE flights 
            SET available_capacity = available_capacity - @count
            OUTPUT INSERTED.available_capacity
            WHERE id = @id AND available_capacity >= @count
        `, { id: flight.id, count: passenger_count });

        if (!updateResult.data) {
            // Race condition: Biz işlem yaparken başkası son bileti almış olabilir
            return res.status(409).json({ error: 'Seats no longer available. Please try again.' });
        }

        // Insert Booking
        const { data: booking, error: bookingError } = await db.querySingle(`
            INSERT INTO bookings (
                booking_reference, flight_id, passenger_count, total_price, 
                status, contact_email, contact_phone, miles_member_id, seats_booked
            )
            OUTPUT INSERTED.*
            VALUES (
                @ref, @fid, @count, @price, 
                'CONFIRMED', @email, @phone, @mid, @seats
            )
        `, {
            ref: bookingRef,
            fid: flight.id,
            count: passenger_count,
            price: totalPrice,
            email: passenger_details.email,
            phone: passenger_details.phone,
            mid: finalMemberId || null,
            seats: JSON.stringify(passenger_details) // Store full details as JSON
        });

        if (bookingError) {
            // KRİTİK HATASI: Koltuk sayısını düştük ama bileti oluşturamadık! Geri alıyoruz (Rollback).
            await db.query('UPDATE flights SET available_capacity = available_capacity + @count WHERE id = @id', {
                count: passenger_count, id: flight.id
            });
            throw new Error('Booking failed: ' + bookingError.message);
        }

        // 7. Onay Mailini Sıraya Al
        queueBookingEmail({
            booking_reference: bookingRef,
            flight_number: flight.flight_number,
            origin: flight.origin_city || flight.origin_airport_code, // Use enriched data
            destination: flight.destination_city || flight.destination_airport_code,
            departure_time: flight.departure_time,
            arrival_time: flight.arrival_time,
            passengers: passenger_count,
            total_price,
            contact_email: passenger_details.email,
            passenger_names: `${passenger_details.first_name} ${passenger_details.last_name}`,
            seats_booked: passenger_count
        });

        // 8. Önbelleği (Cache) Temizle (Kapasitenin güncel görünmesi için şart)
        await cache.delByPattern('cache:search:*'); // Arama sonuçları önbelleğini temizle
        if (flight.id) await cache.del(`cache:flight:${flight.id}`); // Uçuş detay önbelleğini temizle
        console.log('🗑️  Cache invalidated after booking');

        res.status(201).json({
            message: 'Booking successful',
            booking
        });
        // 5. Eğer parayla alındıysa ve üyeyse Mil Puanı ver
        console.log(`💳 Booking Complete - Payment: ${payment_method}, MemberID: ${finalMemberId}`);

        if (payment_method === 'MONEY' && finalMemberId) {
            try {
                const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
                const milesEarned = Math.floor(totalPrice * 10);

                console.log(` Awarding ${milesEarned} miles to member ${finalMemberId}...`);

                const addRes = await fetch(`${process.env.MILES_SERVICE_URL || 'http://localhost:3002'}/api/v1/miles/add`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-service-key': process.env.SERVICE_KEY || 'my-secret-service-key'
                    },
                    body: JSON.stringify({
                        member_id: finalMemberId,
                        points: milesEarned,
                        description: `Earned from booking ${bookingRef}`,
                        flight_id: flight.id,
                        source: 'Flight Booking'
                    })
                });

                if (addRes.ok) {
                    const data = await addRes.json();
                    console.log(`✈️ SUCCESS! Awarded ${milesEarned} miles. New total: ${data.new_total}`);
                } else {
                    const err = await addRes.json();
                    console.error(`❌ Miles award failed:`, err);
                }
            } catch (e) {
                console.error('❌ Miles award exception:', e.message);
            }
        } else {
            console.log(`⏭️ Skip miles: payment=${payment_method}, member=${finalMemberId}`);
        }

        res.status(201).json({
            message: 'Booking successful',
            booking: booking
        });

    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/bookings/member/:id - Get member bookings
app.get('/api/v1/bookings/member/:id', optionalAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { data: bookings, error } = await db.query(`
            SELECT b.*, f.flight_number, f.departure_time, f.arrival_time, 
                   oa.city as origin, da.city as destination
            FROM bookings b
            JOIN flights f ON b.flight_id = f.id
            JOIN airports oa ON f.origin_airport_id = oa.id
            JOIN airports da ON f.destination_airport_id = da.id
            WHERE b.miles_member_id = @id
            ORDER BY b.created_at DESC
        `, { id: parseInt(id) });

        if (error) throw error;
        res.json({ bookings: bookings || [] });

    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`✈️ Flight Service using Azure SQL & Cognito running on port ${PORT}`);
});
