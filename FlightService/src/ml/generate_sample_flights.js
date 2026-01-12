/**
 * Sample Flight Data Generator
 * Generates realistic flight data for testing and training
 * 
 * Usage: node generate_sample_flights.js > sample_flights.json
 */

const airports = [
    // Turkey
    { code: 'IST', city: 'Istanbul', country: 'Turkey', isHub: true },
    { code: 'SAW', city: 'Istanbul', country: 'Turkey', isHub: false },
    { code: 'AYT', city: 'Antalya', country: 'Turkey', isHub: false },
    { code: 'ADB', city: 'Izmir', country: 'Turkey', isHub: false },
    { code: 'ESB', city: 'Ankara', country: 'Turkey', isHub: false },
    
    // USA
    { code: 'JFK', city: 'New York', country: 'USA', isHub: true },
    { code: 'LAX', city: 'Los Angeles', country: 'USA', isHub: true },
    { code: 'SFO', city: 'San Francisco', country: 'USA', isHub: true },
    { code: 'MIA', city: 'Miami', country: 'USA', isHub: true },
    { code: 'ORD', city: 'Chicago', country: 'USA', isHub: true },
    { code: 'DFW', city: 'Dallas', country: 'USA', isHub: true },
    
    // Europe
    { code: 'LHR', city: 'London', country: 'UK', isHub: true },
    { code: 'CDG', city: 'Paris', country: 'France', isHub: true },
    { code: 'FRA', city: 'Frankfurt', country: 'Germany', isHub: true },
    { code: 'AMS', city: 'Amsterdam', country: 'Netherlands', isHub: true },
    { code: 'MAD', city: 'Madrid', country: 'Spain', isHub: true },
    { code: 'FCO', city: 'Rome', country: 'Italy', isHub: true },
    
    // Middle East
    { code: 'DXB', city: 'Dubai', country: 'UAE', isHub: true },
    { code: 'AUH', city: 'Abu Dhabi', country: 'UAE', isHub: false },
    { code: 'DOH', city: 'Doha', country: 'Qatar', isHub: true },
    
    // Asia
    { code: 'SIN', city: 'Singapore', country: 'Singapore', isHub: true },
    { code: 'BKK', city: 'Bangkok', country: 'Thailand', isHub: true },
    { code: 'HKG', city: 'Hong Kong', country: 'Hong Kong', isHub: true },
    { code: 'NRT', city: 'Tokyo', country: 'Japan', isHub: true },
    { code: 'ICN', city: 'Seoul', country: 'South Korea', isHub: true },
];

// Route distances in km (approximate)
const routeDistances = {
    'IST-DXB': 3100, 'IST-JFK': 7800, 'IST-LHR': 2500, 'IST-AYT': 480,
    'IST-CDG': 2400, 'IST-FRA': 1900, 'IST-AMS': 2200, 'IST-SIN': 8500,
    'JFK-LAX': 4000, 'JFK-MIA': 1800, 'JFK-LHR': 5500, 'JFK-SFO': 4100,
    'LHR-CDG': 340, 'LHR-FRA': 650, 'LHR-AMS': 360, 'LHR-MAD': 1250,
    'DXB-SIN': 6200, 'DXB-BKK': 4600, 'DXB-HKG': 5600, 'DXB-LHR': 5500,
    'SIN-BKK': 1400, 'SIN-HKG': 2600, 'SIN-NRT': 5300,
};

function getDistance(origin, dest) {
    const key1 = `${origin}-${dest}`;
    const key2 = `${dest}-${origin}`;
    return routeDistances[key1] || routeDistances[key2] || null;
}

function estimateDuration(distanceKm) {
    // Average speed ~800 km/h, add some buffer
    return Math.round((distanceKm / 800) * 60) + Math.floor(Math.random() * 30) - 15;
}

function generateFlights(count = 100) {
    const flights = [];
    const now = new Date();
    
    // Popular routes
    const popularRoutes = [
        ['IST', 'DXB'], ['IST', 'JFK'], ['IST', 'LHR'], ['IST', 'AYT'],
        ['JFK', 'LAX'], ['JFK', 'MIA'], ['LHR', 'CDG'], ['DXB', 'SIN'],
        ['SAW', 'DXB'], ['IST', 'FRA'], ['IST', 'AMS'], ['DXB', 'BKK'],
    ];
    
    for (let i = 0; i < count; i++) {
        // Random route
        const route = popularRoutes[Math.floor(Math.random() * popularRoutes.length)];
        const [originCode, destCode] = route;
        
        const origin = airports.find(a => a.code === originCode);
        const dest = airports.find(a => a.code === destCode);
        
        if (!origin || !dest) continue;
        
        // Random date in next 90 days
        const daysAhead = Math.floor(Math.random() * 90);
        const departureDate = new Date(now);
        departureDate.setDate(departureDate.getDate() + daysAhead);
        
        // Random departure hour (prefer peak hours)
        const hour = Math.random() < 0.6 
            ? Math.floor(Math.random() * 4) + (Math.random() < 0.5 ? 6 : 17) // Peak hours
            : Math.floor(Math.random() * 24);
        
        departureDate.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
        
        // Calculate duration
        const distance = getDistance(originCode, destCode);
        const durationMinutes = distance ? estimateDuration(distance) : 180 + Math.floor(Math.random() * 300);
        
        // Arrival time
        const arrivalDate = new Date(departureDate);
        arrivalDate.setMinutes(arrivalDate.getMinutes() + durationMinutes);
        
        // Capacity (typical aircraft sizes)
        const capacities = [120, 150, 180, 220, 300, 350];
        const totalCapacity = capacities[Math.floor(Math.random() * capacities.length)];
        const availableCapacity = Math.floor(totalCapacity * (0.3 + Math.random() * 0.6));
        
        // Flight number
        const airlines = ['TK', 'AA', 'LH', 'EK', 'BA', 'AF', 'DL', 'UA'];
        const airline = airlines[Math.floor(Math.random() * airlines.length)];
        const flightNumber = `${airline}${Math.floor(Math.random() * 9000) + 1000}`;
        
        // Is direct (70% chance)
        const isDirect = Math.random() < 0.7;
        
        flights.push({
            flight_number: flightNumber,
            origin_airport_code: originCode,
            destination_airport_code: destCode,
            departure_time: departureDate.toISOString(),
            arrival_time: arrivalDate.toISOString(),
            duration_minutes: durationMinutes,
            total_capacity: totalCapacity,
            available_capacity: availableCapacity,
            is_direct: isDirect,
            status: 'SCHEDULED'
        });
    }
    
    return flights;
}

// Generate and output
if (require.main === module) {
    const count = parseInt(process.argv[2]) || 200;
    const flights = generateFlights(count);
    
    console.log(JSON.stringify({
        flights,
        generated_at: new Date().toISOString(),
        count: flights.length
    }, null, 2));
}

module.exports = { generateFlights, airports };
