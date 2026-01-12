/**
 * Export real flight data from database to CSV for ML training
 * 
 * This script extracts all flights from the database and converts them
 * to CSV format that the Python ML training script can use.
 */

const { sql, poolPromise } = require('./src/config/db');
const fs = require('fs');
const path = require('path');

async function exportFlightDataToCSV() {
    console.log('📊 Exporting flight data from database for ML training...\n');

    try {
        // Use existing connection pool
        const pool = await poolPromise;
        console.log('✓ Using existing database connection');

        // Query flights with all necessary features  
        const result = await pool.request().query(`
            SELECT 
                f.id,
                f.flight_number,
                (SELECT code FROM airports WHERE id = f.origin_airport_id) as origin_code,
                (SELECT code FROM airports WHERE id = f.destination_airport_id) as dest_code,
                f.departure_time,
                f.arrival_time,
                f.duration_minutes,
                f.base_price,
                f.predicted_price,
                f.total_capacity,
                f.available_capacity,
                f.is_direct,
                DATEPART(HOUR, f.departure_time) as departure_hour,
                DATEPART(WEEKDAY, f.departure_time) - 1 as day_of_week,
                DATEPART(MONTH, f.departure_time) - 1 as month
            FROM flights f
            WHERE f.departure_time >= DATEADD(day, -365, GETDATE())
            ORDER BY f.departure_time DESC
        `);

        const flights = result.recordset;
        console.log(`✓ Retrieved ${flights.length} flights from database\n`);

        if (flights.length === 0) {
            console.log('⚠️  No flights found in database!');
            console.log('   You may need to populate the database first.');
            return;
        }

        // Transform to ML training format
        const mlData = flights.map(f => {
            const depTime = new Date(f.departure_time);
            const now = new Date();

            // Calculate days advance (estimate based on current time)
            const daysUntilFlight = Math.max(0, Math.ceil((depTime - now) / (1000 * 60 * 60 * 24)));
            const daysAdvance = daysUntilFlight > 0 ? Math.min(60, daysUntilFlight) : Math.floor(Math.random() * 60);

            // Determine if peak hour
            const isPeakHour = (f.departure_hour >= 6 && f.departure_hour <= 9) ||
                (f.departure_hour >= 17 && f.departure_hour <= 20);

            // Determine if weekend (Saturday=6, Sunday=0 in JS)
            const isWeekend = f.day_of_week === 0 || f.day_of_week === 6;

            // Determine if busy month (Jan, Jun, Jul, Aug, Dec)
            const isBusyMonth = [0, 5, 6, 7, 11].includes(f.month);

            // Check if international (simple heuristic)
            const isInternational = f.duration_minutes > 180 ? 1 : 0;

            // Major hub check
            const majorHubs = ['IST', 'JFK', 'LAX', 'LHR', 'CDG', 'FRA', 'DXB', 'SIN', 'HKG', 'NRT', 'ICN'];
            const isMajorHub = majorHubs.includes(f.origin_code) || majorHubs.includes(f.dest_code) ? 1 : 0;

            // Estimate distance (avg speed 800 km/h)
            const distanceKm = f.duration_minutes * 13.33; // 800 km/h = 13.33            
            // Use predicted_price if available, otherwise base_price
            const price = f.predicted_price || f.base_price;

            return {
                duration_minutes: f.duration_minutes,
                departure_hour: f.departure_hour,
                day_of_week: f.day_of_week,
                month: f.month,
                days_advance: daysAdvance,
                is_direct: f.is_direct ? 1 : 0,
                is_international: isInternational,
                is_weekend: isWeekend ? 1 : 0,
                is_peak_hour: isPeakHour ? 1 : 0,
                is_busy_month: isBusyMonth ? 1 : 0,
                is_major_hub: isMajorHub,
                distance_km: Math.round(distanceKm),
                price: price
            };
        });

        // Convert to CSV
        const headers = [
            'duration_minutes', 'departure_hour', 'day_of_week', 'month',
            'days_advance', 'is_direct', 'is_international', 'is_weekend',
            'is_peak_hour', 'is_busy_month', 'is_major_hub', 'distance_km', 'price'
        ];

        let csvContent = headers.join(',') + '\n';
        mlData.forEach(row => {
            csvContent += headers.map(h => row[h]).join(',') + '\n';
        });

        // Save to file
        const outputPath = path.join(__dirname, 'src', 'ml', 'flight_prices.csv');
        fs.writeFileSync(outputPath, csvContent, 'utf8');

        console.log('═════════════════════════════════════════════════');
        console.log('✅ EXPORT COMPLETE');
        console.log('═════════════════════════════════════════════════');
        console.log(`📁 File: ${outputPath}`);
        console.log(`📊 Records: ${mlData.length}`);
        console.log(`💰 Price range: $${Math.min(...mlData.map(d => d.price))}-$${Math.max(...mlData.map(d => d.price))}`);
        console.log(`⏱️  Duration range: ${Math.min(...mlData.map(d => d.duration_minutes))}-${Math.max(...mlData.map(d => d.duration_minutes))} min`);

        console.log('\n🎯 Next steps:');
        console.log('   1. Review flight_prices.csv');
        console.log('   2. Run: cd src/ml && python train_model_improved.py');
        console.log('   3. Model will train on YOUR REAL flight data!\n');

    } catch (err) {
        console.error('❌ Error exporting data:', err.message);
        console.error('   Make sure database is running and populated with flights');
    }
}

// Run export
exportFlightDataToCSV();
