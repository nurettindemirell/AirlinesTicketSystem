const sql = require('mssql');
const dotenv = require('dotenv');

// Load env (default is .env in current dir)
const path = require('path');
// Load env from the same directory as this script
dotenv.config({ path: path.join(__dirname, '.env') });

const config = {
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 60000 // 60 seconds
    }
};

const airports = [
    { code: 'IST', name: 'Istanbul Airport', city: 'Istanbul', country: 'Turkey' },
    { code: 'SAW', name: 'Sabiha Gokcen Airport', city: 'Istanbul', country: 'Turkey' },
    { code: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'USA' },
    { code: 'LHR', name: 'Heathrow Airport', city: 'London', country: 'UK' },
    { code: 'CDG', name: 'Charles de Gaulle Airport', city: 'Paris', country: 'France' },
    { code: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'Germany' },
    { code: 'DXB', name: 'Dubai International Airport', city: 'Dubai', country: 'UAE' },
    { code: 'AMS', name: 'Schiphol Airport', city: 'Amsterdam', country: 'Netherlands' }
];

async function seed() {
    try {
        console.log('🔌 Connecting to Azure SQL...');
        const pool = await sql.connect(config);
        console.log('✅ Connected.');

        // 1. Insert Airports
        console.log('✈️  Seeding Airports...');
        for (const airport of airports) {
            // Check if exists
            const result = await pool.request()
                .input('code', sql.Char(3), airport.code)
                .query('SELECT id FROM airports WHERE code = @code');

            if (result.recordset.length === 0) {
                await pool.request()
                    .input('code', sql.Char(3), airport.code)
                    .input('name', sql.NVarChar, airport.name)
                    .input('city', sql.NVarChar, airport.city)
                    .input('country', sql.NVarChar, airport.country)
                    .query('INSERT INTO airports (code, name, city, country) VALUES (@code, @name, @city, @country)');
                console.log(`   + Added ${airport.code}`);
            } else {
                console.log(`   = Skipped ${airport.code} (exists)`);
            }
        }

        // 2. Insert Flights
        console.log('🛫 Seeding Flights...');

        // Get all airport IDs
        const airportResult = await pool.request().query('SELECT id, code from airports');
        const airportMap = {};
        airportResult.recordset.forEach(a => airportMap[a.code] = a.id);

        const routes = [
            { from: 'IST', to: 'JFK', duration: 660, price: 800 },
            { from: 'JFK', to: 'IST', duration: 600, price: 750 },
            { from: 'IST', to: 'LHR', duration: 240, price: 300 },
            { from: 'LHR', to: 'IST', duration: 220, price: 280 },
            { from: 'IST', to: 'DXB', duration: 270, price: 400 },
            { from: 'DXB', to: 'IST', duration: 280, price: 380 },
            { from: 'SAW', to: 'AMS', duration: 210, price: 200 },
            { from: 'AMS', to: 'SAW', duration: 200, price: 180 },
            { from: 'CDG', to: 'JFK', duration: 480, price: 600 },
            { from: 'FRA', to: 'DXB', duration: 360, price: 550 }
        ];

        // Generate flights for next 30 days
        const today = new Date();
        let flightCount = 0;

        for (let i = 1; i <= 30; i++) {
            const flightDate = new Date(today);
            flightDate.setDate(today.getDate() + i);

            for (const route of routes) {
                // Morning Flight
                const depTime1 = new Date(flightDate);
                depTime1.setHours(9 + Math.floor(Math.random() * 3), 0, 0); // 9-12 AM
                const arrTime1 = new Date(depTime1.getTime() + route.duration * 60000);

                // Evening Flight
                const depTime2 = new Date(flightDate);
                depTime2.setHours(18 + Math.floor(Math.random() * 3), 0, 0); // 6-9 PM
                const arrTime2 = new Date(depTime2.getTime() + route.duration * 60000);

                await insertFlight(pool, route, depTime1, arrTime1, airportMap);
                await insertFlight(pool, route, depTime2, arrTime2, airportMap);
                flightCount += 2;
            }
        }

        console.log(`✅ Seeded ${flightCount} flights successfully.`);

    } catch (err) {
        console.error('❌ Seeding failed:', err);
    } finally {
        sql.close();
    }
}

async function insertFlight(pool, route, dep, arr, map) {
    const flightNum = route.from.substring(0, 2) + Math.floor(100 + Math.random() * 900); // e.g., IS345

    // Check if flight roughly exists
    const check = await pool.request()
        .input('fn', flightNum)
        .input('dep', dep)
        .query('SELECT id FROM flights WHERE flight_number = @fn AND departure_time = @dep');

    if (check.recordset.length === 0) {
        await pool.request()
            .input('fn', sql.NVarChar, flightNum)
            .input('orig', sql.Int, map[route.from])
            .input('dest', sql.Int, map[route.to])
            .input('dep', sql.DateTime2, dep)
            .input('arr', sql.DateTime2, arr)
            .input('dur', sql.Int, route.duration)
            .input('cap', sql.Int, 200) // Fixed capacity
            .input('price', sql.Decimal(10, 2), route.price)
            .query(`
                INSERT INTO flights (
                    flight_number, origin_airport_id, destination_airport_id,
                    departure_time, arrival_time, duration_minutes,
                    total_capacity, available_capacity, base_price,
                    predicted_price, is_direct, status
                ) VALUES (
                    @fn, @orig, @dest,
                    @dep, @arr, @dur,
                    @cap, @cap, @price,
                    @price, 1, 'SCHEDULED'
                )
            `);
        process.stdout.write('.');
    }
}

seed();
