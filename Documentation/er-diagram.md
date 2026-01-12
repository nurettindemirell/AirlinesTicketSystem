# SE4458 Flight System - ER Diagram

```mermaid
erDiagram
    AIRPORTS {
        uuid id PK
        varchar code UK
        varchar name
        varchar city
        varchar country
        timestamp created_at
    }
    
    FLIGHTS {
        uuid id PK
        varchar flight_number
        uuid origin_airport_id FK
        uuid destination_airport_id FK
        timestamp departure_time
        timestamp arrival_time
        int duration_minutes
        int total_capacity
        int available_capacity
        decimal base_price
        decimal predicted_price
        boolean is_direct
        varchar status
        timestamp created_at
    }
    
    MILES_MEMBERS {
        uuid id PK
        uuid user_id UK
        varchar member_number UK
        varchar email
        varchar first_name
        varchar last_name
        varchar phone
        int total_points
        varchar tier
        timestamp created_at
    }
    
    BOOKINGS {
        uuid id PK
        varchar booking_reference UK
        uuid flight_id FK
        uuid user_id
        uuid miles_member_id FK
        int passenger_count
        decimal total_price
        int points_used
        varchar payment_method
        varchar status
        varchar contact_email
        timestamp created_at
    }
    
    PASSENGERS {
        uuid id PK
        uuid booking_id FK
        varchar first_name
        varchar last_name
        date date_of_birth
        varchar passport_number
        varchar nationality
        timestamp created_at
    }
    
    MILES_LEDGER {
        uuid id PK
        uuid member_id FK
        varchar transaction_type
        int points
        text description
        uuid flight_id FK
        uuid booking_id FK
        varchar source
        timestamp created_at
    }
    
    PROCESSED_FLIGHT_MILES {
        uuid id PK
        uuid flight_id FK UK
        timestamp processed_at
        int bookings_processed
        int points_awarded
    }

    AIRPORTS ||--o{ FLIGHTS : "origin"
    AIRPORTS ||--o{ FLIGHTS : "destination"
    FLIGHTS ||--o{ BOOKINGS : "has"
    BOOKINGS ||--o{ PASSENGERS : "contains"
    MILES_MEMBERS ||--o{ BOOKINGS : "makes"
    MILES_MEMBERS ||--o{ MILES_LEDGER : "has"
    FLIGHTS ||--o{ MILES_LEDGER : "earns"
    BOOKINGS ||--o{ MILES_LEDGER : "from"
    FLIGHTS ||--o| PROCESSED_FLIGHT_MILES : "processed"
```

## Tables Overview

| Table | Description |
|-------|-------------|
| `airports` | Airport master data (IST, JFK, LHR, etc.) |
| `flights` | Flight schedules with capacity and pricing |
| `miles_members` | MilesSmiles loyalty program members |
| `bookings` | Flight reservations |
| `passengers` | Individual passengers per booking |
| `miles_ledger` | Points transactions (earned/redeemed) |
| `processed_flight_miles` | Tracks nightly miles processing |

## Key Relationships

1. **Flights ↔ Airports**: Each flight has origin and destination airports
2. **Bookings ↔ Flights**: Bookings are for specific flights
3. **Bookings ↔ Passengers**: Each booking has 1+ passengers
4. **Bookings ↔ Miles_Members**: Optional link for loyalty members
5. **Miles_Ledger ↔ Members**: Tracks all point transactions
