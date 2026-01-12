/**
 * ML Price Prediction Module
 * Migrated from PredictionService (Python)
 * 
 * Features used for prediction (6 Core Features):
 * 1. Duration (minutes)
 * 2. Peak Hour (Departure Time)
 * 3. Days Advance (Booking Timing)
 * 4. Is Direct Flight
 * 5. Route Type (International/Domestic)
 * 6. Is Weekend
 */

// Default coefficients (fallback)
let MODEL_COEFFICIENTS = {
    base_price: 120.0,
    duration_coef: 0.35,
    peak_hour_premium: 40.0,
    weekend_premium: 50.0,
    direct_flight_premium: 60.0,
    international_multiplier: 1.7,
    last_minute_surge: 0.90,
    advance_discount: 0.02,
    busy_month_multiplier: 1.15,
    off_peak_discount: 0.10
};

let MODEL_CONFIDENCE = 0.94;

// Load trained model coefficients from JSON file
try {
    const fs = require('fs');
    const path = require('path');
    const modelPath = path.join(__dirname, 'model_coefficients.json');
    if (fs.existsSync(modelPath)) {
        const modelData = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        if (modelData.coefficients) {
            const c = modelData.coefficients;
            // Map JSON keys to our internal keys
            MODEL_COEFFICIENTS = {
                base_price: c.basePrice || 120.0,
                duration_coef: c.durationCoef || 0.35,
                peak_hour_premium: c.peakHourCoef || 40.0,
                weekend_premium: c.weekendCoef || 50.0,
                direct_flight_premium: c.directFlightPremium || 60.0,
                international_multiplier: c.internationalMultiplier || 1.7,
                last_minute_surge: c.lastMinuteCoef || 0.90,
                advance_discount: c.advanceBookingDiscount || 0.02,
                busy_month_multiplier: c.busyMonthMultiplier || 1.15,
                off_peak_discount: c.offPeakDiscount || 0.10
            };
            MODEL_CONFIDENCE = modelData.confidence || 0.94;
            console.log('🧠 Loaded trained ML model coefficients from ' + modelPath);
        }
    }
} catch (err) {
    console.log('⚠️  Could not load model coefficients, using defaults', err.message);
}

// Airport country mapping (Extended list for better detection)
const AIRPORT_COUNTRIES = {
    // Turkey
    'IST': 'Turkey', 'SAW': 'Turkey', 'ESB': 'Turkey', 'ADB': 'Turkey', 'AYT': 'Turkey',
    // USA
    'JFK': 'USA', 'LAX': 'USA', 'ORD': 'USA', 'DFW': 'USA', 'MIA': 'USA', 'SFO': 'USA',
    // Europe
    'LHR': 'UK', 'CDG': 'France', 'FRA': 'Germany', 'AMS': 'Netherlands', 'MAD': 'Spain',
    'FCO': 'Italy', 'VIE': 'Austria', 'ZUR': 'Switzerland', 'CPH': 'Denmark',
    // Middle East
    'DXB': 'UAE', 'AUH': 'UAE', 'DOH': 'Qatar', 'RUH': 'Saudi Arabia',
    // Asia
    'SIN': 'Singapore', 'BKK': 'Thailand', 'HKG': 'Hong Kong',
    'NRT': 'Japan', 'ICN': 'South Korea', 'PEK': 'China'
};

/**
 * Predict flight price based on flight attributes
 * Matches Python implementation exactly.
 * 
 * @param {Object} params - Flight parameters
 * @param {number} params.durationMinutes - Flight duration in minutes
 * @param {Date|string} params.departureTime - Departure date/time
 * @param {boolean} params.isDirect - Whether flight is direct
 * @param {string} params.originCode - Origin airport code
 * @param {string} params.destinationCode - Destination airport code
 * @returns {Object} Prediction result with price and breakdown
 */
function predictPrice(params) {
    const {
        durationMinutes,
        departureTime,
        isDirect = true,
        originCode,
        destinationCode
    } = params;

    const depDate = new Date(departureTime);
    const now = new Date();

    // FEATURE 1: Duration Cost
    const durationCost = durationMinutes * MODEL_COEFFICIENTS.duration_coef;

    // FEATURE 2: Peak Hour (6-9 or 17-20)
    const hour = depDate.getHours();
    const isPeakHour = (hour >= 6 && hour <= 9) || (hour >= 17 && hour <= 20);
    const peakPremium = isPeakHour ? MODEL_COEFFICIENTS.peak_hour_premium : 0;

    // FEATURE 3: Days Advance (Booking logic)
    // Diff in days (ensure positive)
    const diffTime = depDate - now;
    const daysUntilFlight = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    let lastMinuteCost = 0;

    if (daysUntilFlight < 7) {
        // Last minute surge
        const urgencyFactor = (7 - daysUntilFlight) / 7;
        lastMinuteCost = durationCost * MODEL_COEFFICIENTS.last_minute_surge * urgencyFactor;
    } else if (daysUntilFlight >= 7 && daysUntilFlight <= 30) {
        // Early booking discount
        const discountDays = Math.min(daysUntilFlight - 7, 23);
        lastMinuteCost = -(durationCost * MODEL_COEFFICIENTS.advance_discount * discountDays);
    } else {
        lastMinuteCost = 0;
    }

    // FEATURE 4: Direct Flight
    const directPremium = isDirect ? MODEL_COEFFICIENTS.direct_flight_premium : 0;

    // FEATURE 5: Route Type (International/Domestic)
    const originCountry = AIRPORT_COUNTRIES[originCode?.toUpperCase()];
    const destCountry = AIRPORT_COUNTRIES[destinationCode?.toUpperCase()];

    let isInternational = false;
    if (originCountry && destCountry) {
        isInternational = originCountry !== destCountry;
    } else {
        // Fallback: > 3 hours implied international
        isInternational = durationMinutes > 180;
    }

    const internationalMultiplier = isInternational ? MODEL_COEFFICIENTS.international_multiplier : 1.0;

    // FEATURE 6: Weekend (Saturday=6, Sunday=0 in JS Date.getDay())
    // Python: Saturday=5, Sunday=6. Logic: >=5
    const dayOfWeek = depDate.getDay(); // 0=Sun, 6=Sat
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const weekendPremium = isWeekend ? MODEL_COEFFICIENTS.weekend_premium : 0;


    
    // Final Calculation
    const base = MODEL_COEFFICIENTS.base_price;
    let predictedPrice = (base + durationCost + peakPremium + directPremium + weekendPremium + lastMinuteCost) * internationalMultiplier;

    // Minimum Price Security
    const minPrice = isInternational ? 150 : 80;
    predictedPrice = Math.max(predictedPrice, minPrice);

    // Rounding
    predictedPrice = Math.round(predictedPrice * 100) / 100;

    return {
        price: predictedPrice, // 'price' to match Python return shape generally, or keep 'predictedPrice' if used elsewhere
        predictedPrice: predictedPrice, // Keeping mostly compatible with existing JS calls
        currency: 'USD',
        confidence: MODEL_CONFIDENCE,
        features_used: {
            duration_minutes: durationMinutes,
            peak_hour: isPeakHour,
            days_advance: daysUntilFlight,
            is_direct: isDirect,
            route_type: isInternational ? 'international' : 'domestic',
            is_weekend: isWeekend
        },
        breakdown: {
            base_cost: base,
            duration_cost: Math.round(durationCost * 100) / 100,
            peak_premium: peakPremium,
            weekend_premium: weekendPremium,
            direct_premium: directPremium,
            booking_timing: Math.round(lastMinuteCost * 100) / 100,
            international_multiplier: internationalMultiplier
        }
    };
}

/**
 * Batch predict prices for multiple flights
 */
function predictPrices(flights) {
    return flights.map(flight => ({
        flightId: flight.id,
        ...predictPrice({
            durationMinutes: flight.duration_minutes,
            departureTime: flight.departure_time,
            isDirect: flight.is_direct,
            originCode: flight.origin_code || flight.origin?.code,
            destinationCode: flight.dest_code || flight.destination?.code
        })
    }));
}

module.exports = {
    predictPrice,
    predictPrices,
    MODEL_COEFFICIENTS,
    AIRPORT_COUNTRIES
};
