import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { signIn, getCurrentUser } from 'aws-amplify/auth'

const FLIGHT_API_BASE = 'http://localhost:3001'

export default function BookingPage({ milesUser }) {
    const navigate = useNavigate()
    const location = useLocation()
    const flight = location.state?.flight

    // Form Durumu
    const [passenger, setPassenger] = useState({
        title: 'Mr',
        first_name: '',
        last_name: '',
        dob: '',
        email: '',
        phone: '',
        is_member_request: false,
    })

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)
    const [bookingRef, setBookingRef] = useState('')
    const [remainingSeats, setRemainingSeats] = useState(null)

    // Giriş yapılmışsa önceden doldur
    useEffect(() => {
        if (milesUser) {
            setPassenger(p => ({
                ...p,
                first_name: milesUser.first_name || '',
                last_name: milesUser.last_name || '',
                email: milesUser.email || '',
                phone: milesUser.phone || ''
            }))
        }
    }, [milesUser])

    if (!flight) {
        return <div className="p-8 text-center"><p>No flight selected. <button onClick={() => navigate('/')}>Go Home</button></p></div>
    }

    const handleBook = async (paymentMethod) => {
        setLoading(true)
        setError('')
        try {
            // Doğrulama
            if (!passenger.first_name || !passenger.last_name || !passenger.dob || !passenger.email) {
                throw new Error('Please fill in all passenger details')
            }

            const body = {
                flight_id: flight.id,
                passenger_count: 1, // Şimdilik basitleştirildi
                passenger_details: {
                    ...passenger,
                    dob: passenger.dob
                },
                payment_method: paymentMethod, // 'MONEY' veya 'MILES'
                miles_member_id: milesUser?.id
            }

            const res = await fetch(`${FLIGHT_API_BASE}/api/v1/bookings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Booking failed')

            setSuccess(true)
            setBookingRef(data.booking.booking_reference)

            // Kalan koltukları göstermek için güncel uçuş bilgisini getir
            try {
                const flightRes = await fetch(`${FLIGHT_API_BASE}/api/v1/flights/search?from=${flight.origin.code}&to=${flight.destination.code}&date=${new Date(flight.departure_time).toISOString().split('T')[0]}`)
                const flightData = await flightRes.json()
                const updatedFlight = flightData.flights.find(f => f.id === flight.id)
                if (updatedFlight) {
                    setRemainingSeats(updatedFlight.available_capacity)
                }
            } catch (e) {
                console.log('Could not fetch updated capacity')
            }

        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="container" style={{ maxWidth: '600px', margin: '4rem auto', textAlign: 'center' }}>
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎉</div>
                <h1>Booking Confirmed!</h1>
                <p className="subtitle">Reference: <strong>{bookingRef}</strong></p>
                <div className="card" style={{ marginTop: '2rem', textAlign: 'left' }}>
                    <h3>Flight Details</h3>
                    <p><strong>{flight.flight_number}</strong>: {flight.origin.city} ({flight.origin.code}) → {flight.destination.city} ({flight.destination.code})</p>
                    <p>Passenger: {passenger.first_name} {passenger.last_name}</p>
                    {remainingSeats !== null && (
                        <p style={{ color: '#f59e0b', fontWeight: '500' }}>📍 {remainingSeats} seats remaining on this flight</p>
                    )}
                    <p>Please check your email ({passenger.email}) for the ticket.</p>
                </div>
                <button className="btn btn-primary" style={{ marginTop: '2rem' }} onClick={() => navigate('/')}>Book Another Flight</button>
            </div>
        )
    }

    return (
        <div className="booking-page" style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem' }}>
            <h1 style={{ marginBottom: '2rem' }}>Buy Ticket</h1>

            {/* Uçuş Özeti */}
            <div className="flight-summary-card" style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1d1d1f' }}>{flight.origin.city} → {flight.destination.city}</div>
                    <div style={{ color: '#86868b' }}>
                        {new Date(flight.departure_time).toLocaleDateString()} • {new Date(flight.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>${flight.base_price}</div>
                    <div style={{ fontSize: '0.9rem', color: '#f59e0b' }}>or {flight.base_price * 10} Miles</div>
                </div>
            </div>

            {!milesUser && (
                <div className="alert-info" style={{ background: '#fffbf0', border: '1px solid #fceeb5', padding: '1rem', borderRadius: '8px', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Turkish_Airlines_Points_Logo.png/120px-Turkish_Airlines_Points_Logo.png" alt="Miles&Smiles" style={{ height: '30px', objectFit: 'contain' }} onError={(e) => e.target.style.display = 'none'} />
                        <div>
                            <strong>Miles&Smiles</strong>
                            <div style={{ fontSize: '0.9rem' }}>You can easily save passenger information by signing in to your account.</div>
                        </div>
                    </div>
                    <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }} onClick={() => navigate('/miles')}>Sign in</button>
                </div>
            )}

            <div className="card" style={{ background: '#fff', padding: '2rem', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>Passenger Information</h2>

                {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

                <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 3fr 3fr', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="form-group">
                        <label>Title</label>
                        <select
                            value={passenger.title}
                            onChange={e => setPassenger({ ...passenger, title: e.target.value })}
                            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #d2d2d7' }}
                        >
                            <option>Mr</option>
                            <option>Ms</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label>First / Middle name</label>
                        <input
                            type="text"
                            className="input-field"
                            value={passenger.first_name}
                            onChange={e => setPassenger({ ...passenger, first_name: e.target.value })}
                            placeholder="Current Name"
                        />
                    </div>
                    <div className="form-group">
                        <label>Surname</label>
                        <input
                            type="text"
                            className="input-field"
                            value={passenger.last_name}
                            onChange={e => setPassenger({ ...passenger, last_name: e.target.value })}
                            placeholder="Surname"
                        />
                    </div>
                </div>

                <div className="form-row" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label>Date of Birth</label>
                        <input
                            type="date"
                            className="input-field"
                            value={passenger.dob}
                            onChange={e => setPassenger({ ...passenger, dob: e.target.value })}
                        />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label>Email</label>
                        <input
                            type="email"
                            className="input-field"
                            value={passenger.email}
                            onChange={e => setPassenger({ ...passenger, email: e.target.value })}
                            placeholder="ticket@example.com"
                        />
                    </div>
                </div>

                {!milesUser && (
                    <div className="checkbox-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', padding: '1rem', background: '#f5f5f7', borderRadius: '8px' }}>
                        <input
                            type="checkbox"
                            id="newMember"
                            checked={passenger.is_member_request}
                            onChange={e => setPassenger({ ...passenger, is_member_request: e.target.checked })}
                            style={{ width: '1.2rem', height: '1.2rem' }}
                        />
                        <label htmlFor="newMember" style={{ fontWeight: '500', cursor: 'pointer' }}>Miles&Smiles Üyesi Olmak İstiyorum</label>
                    </div>
                )}
            </div>

            <div className="actions" style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <button
                    className="btn btn-secondary"
                    style={{ padding: '1rem', fontSize: '1.1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100px' }}
                    onClick={() => handleBook('MONEY')}
                    disabled={loading}
                >
                    <span style={{ fontWeight: 'bold' }}>Pay ${flight.base_price}</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Credit Card</span>
                </button>

                <button
                    className="btn btn-primary"
                    style={{ padding: '1rem', fontSize: '1.1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100px', opacity: milesUser ? 1 : 0.5, cursor: milesUser ? 'pointer' : 'not-allowed' }}
                    onClick={() => milesUser && handleBook('MILES')}
                    disabled={loading || !milesUser}
                    title={!milesUser ? "Login to pay with miles" : ""}
                >
                    <span style={{ fontWeight: 'bold' }}>Pay {flight.base_price * 10} Miles</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>Miles&Smiles Points</span>
                </button>
            </div>
            {!milesUser && <p style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.9rem', color: '#86868b' }}>* Log in to pay with Miles</p>}
        </div>
    )
}
