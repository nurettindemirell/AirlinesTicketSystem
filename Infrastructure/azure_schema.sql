-- Azure SQL Schema for Airline Ticketing System

-- ============================================
-- 1. Airports
-- ============================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='airports' AND xtype='U')
CREATE TABLE airports (
    id INT IDENTITY(1,1) PRIMARY KEY,
    code CHAR(3) NOT NULL UNIQUE,
    name NVARCHAR(255) NOT NULL,
    city NVARCHAR(100) NOT NULL,
    country NVARCHAR(100) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE()
);
GO

-- ============================================
-- 2. Flights
-- ============================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='flights' AND xtype='U')
CREATE TABLE flights (
    id INT IDENTITY(1,1) PRIMARY KEY,
    flight_number NVARCHAR(10) NOT NULL,
    origin_airport_id INT NOT NULL FOREIGN KEY REFERENCES airports(id),
    destination_airport_id INT NOT NULL FOREIGN KEY REFERENCES airports(id),
    departure_time DATETIME2 NOT NULL,
    arrival_time DATETIME2 NOT NULL,
    duration_minutes INT NOT NULL,
    total_capacity INT NOT NULL,
    available_capacity INT NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL,
    predicted_price DECIMAL(10, 2) NULL,
    is_direct BIT DEFAULT 1,
    status NVARCHAR(20) DEFAULT 'SCHEDULED', -- SCHEDULED, CANCELLED, DELAYED, LANDED
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT CK_Flights_Capacity CHECK (available_capacity <= total_capacity)
);
GO

CREATE INDEX IX_Flights_Origin_Dest_Date ON flights(origin_airport_id, destination_airport_id, departure_time);
GO

-- ============================================
-- 3. Miles Members
-- ============================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='miles_members' AND xtype='U')
CREATE TABLE miles_members (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id NVARCHAR(100) NOT NULL UNIQUE, -- Cognito User ID (Sub)
    member_number NVARCHAR(20) NOT NULL UNIQUE,
    email NVARCHAR(255) NOT NULL,
    first_name NVARCHAR(100) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,
    phone NVARCHAR(20) NULL,
    total_points INT DEFAULT 0,
    tier NVARCHAR(20) DEFAULT 'CLASSIC', -- CLASSIC, ELITE, ELITE PLUS
    created_at DATETIME2 DEFAULT GETDATE()
);
GO

-- ============================================
-- 4. Bookings
-- ============================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='bookings' AND xtype='U')
CREATE TABLE bookings (
    id INT IDENTITY(1,1) PRIMARY KEY,
    booking_reference NVARCHAR(10) NOT NULL UNIQUE,
    flight_id INT NOT NULL FOREIGN KEY REFERENCES flights(id),
    passenger_count INT DEFAULT 1,
    total_price DECIMAL(10, 2) NOT NULL,
    status NVARCHAR(20) DEFAULT 'CONFIRMED', -- CONFIRMED, CANCELLED
    contact_email NVARCHAR(255) NOT NULL,
    contact_phone NVARCHAR(20) NULL,
    miles_member_id INT NULL FOREIGN KEY REFERENCES miles_members(id),
    seats_booked NVARCHAR(MAX) NULL, -- JSON string or comma separated
    created_at DATETIME2 DEFAULT GETDATE()
);
GO

-- ============================================
-- 5. Miles Ledger (Transaction History)
-- ============================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='miles_ledger' AND xtype='U')
CREATE TABLE miles_ledger (
    id INT IDENTITY(1,1) PRIMARY KEY,
    member_id INT NOT NULL FOREIGN KEY REFERENCES miles_members(id),
    transaction_type NVARCHAR(20) NOT NULL, -- EARNED, REDEEMED, PARTNER_CREDIT
    points INT NOT NULL,
    description NVARCHAR(255) NULL,
    flight_id INT NULL FOREIGN KEY REFERENCES flights(id),
    booking_id INT NULL FOREIGN KEY REFERENCES bookings(id),
    source NVARCHAR(50) NULL,
    created_at DATETIME2 DEFAULT GETDATE()
);
GO

-- ============================================
-- 6. Processed Flight Miles (Nightly Job Tracker)
-- ============================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='processed_flight_miles' AND xtype='U')
CREATE TABLE processed_flight_miles (
    id INT IDENTITY(1,1) PRIMARY KEY,
    flight_id INT NOT NULL UNIQUE FOREIGN KEY REFERENCES flights(id),
    bookings_processed INT DEFAULT 0,
    points_awarded INT DEFAULT 0,
    processed_at DATETIME2 DEFAULT GETDATE()
);
GO
