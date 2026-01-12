import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom'
import { getCurrentUser, signIn, signUp, signOut, confirmSignUp, fetchAuthSession } from 'aws-amplify/auth'
import BookingPage from './BookingPage'

const API_BASE = 'http://localhost:3002' // Membership Service için (Üye Kimlik Doğrulama)
const FLIGHT_API_BASE = 'http://localhost:3001' // FlightService için (Herkese Açık Uçuş Arama)

function App() {
    const [milesUser, setMilesUser] = useState(null)

    useEffect(() => {
        checkAuth()
    }, [])

    const checkAuth = async () => {
        try {
            const { userId } = await getCurrentUser()
            if (userId) {
                // API çağrısı için token al
                const session = await fetchAuthSession()
                const token = session.tokens.accessToken.toString()
                fetchMilesProfile(token)
            }
        } catch (err) {
            console.log('Not logged in')
        }
    }

    const fetchMilesProfile = async (token) => {
        try {
            const { userId } = await getCurrentUser()
            const res = await fetch(`${API_BASE}/api/v1/miles/members/by-user/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })

            if (res.ok) {
                const data = await res.json()
                setMilesUser(data.member)
            }
        } catch (err) {
            console.error('Failed to fetch miles profile:', err)
        }
    }

    const handleMilesLogout = async () => {
        await signOut()
        setMilesUser(null)
    }

    return (
        <BrowserRouter>
            <div className="app">
                <Header milesUser={milesUser} />
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/miles" element={<MilesPage milesUser={milesUser} setMilesUser={setMilesUser} onLogout={handleMilesLogout} />} />
                    <Route path="/book" element={<BookingPage milesUser={milesUser} />} />
                </Routes>
            </div>
        </BrowserRouter>
    )
}

function Header({ milesUser }) {
    return (
        <header className="header">
            <Link to="/" className="left-link">Book Flight</Link>
            <Link to="/" className="logo">Fly with Bilet</Link>
            <nav className="nav-links">
                <Link to="/miles">{milesUser ? `Member: ${milesUser.member_number}` : 'Member Club'}</Link>
            </nav>
        </header>
    )
}

// ============================================
// MİL SAYFASI
// ============================================
function MilesPage({ milesUser, setMilesUser, onLogout }) {
    const [mode, setMode] = useState('login')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [form, setForm] = useState({ email: '', password: '', first_name: '', last_name: '', code: '' })
    const [bookings, setBookings] = useState([])
    const [bookingsLoading, setBookingsLoading] = useState(false)
    const [confirming, setConfirming] = useState(false) // Doğrulama kodu girişini göster
    const navigate = useNavigate()

    // Giriş yapıldığında kullanıcı rezervasyonlarını getir
    useEffect(() => {
        if (milesUser?.id) {
            fetchUserBookings()
        }
    }, [milesUser?.id])

    const fetchUserBookings = async () => {
        if (!milesUser?.id) return
        setBookingsLoading(true)
        try {
            // Token gerekli
            const session = await fetchAuthSession()
            const token = session.tokens?.accessToken?.toString()

            const res = await fetch(`${FLIGHT_API_BASE}/api/v1/bookings/member/${milesUser.id}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            })
            if (res.ok) {
                const data = await res.json()
                setBookings(data.bookings || [])
            }
        } catch (err) {
            console.error('Failed to fetch bookings:', err)
        } finally {
            setBookingsLoading(false)
        }
    }

    const handleLogin = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        try {
            const { isSignedIn, nextStep } = await signIn({ username: form.email, password: form.password })

            if (nextStep && nextStep.signInStep === 'CONFIRM_SIGN_UP') {
                setConfirming(true)
                setLoading(false)
                return
            }

            if (isSignedIn) {
                const { userId } = await getCurrentUser()
                const session = await fetchAuthSession()
                const token = session.tokens.accessToken.toString()

                // Profili Getir
                const res = await fetch(`${API_BASE}/api/v1/miles/members/by-user/${userId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })

                if (res.ok) {
                    const memberData = await res.json()
                    setMilesUser(memberData.member)
                } else {
                    setError('No Miles&Smiles membership found. Please contact support.')
                }
            }
        } catch (err) {
            setError(err.message)
            if (err.name === 'UserNotConfirmedException') {
                setConfirming(true)
            }
        } finally {
            setLoading(false)
        }
    }

    const handleRegister = async (e) => {
        e.preventDefault()
        if (form.password.length < 8) {
            setError('Password must be at least 8 characters')
            return
        }
        setLoading(true)
        setError('')
        try {
            const { isSignUpComplete, userId, nextStep } = await signUp({
                username: form.email,
                password: form.password,
                options: {
                    userAttributes: {
                        email: form.email,
                        given_name: form.first_name,
                        family_name: form.last_name
                    }
                }
            })

            setConfirming(true)

        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleConfirm = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        try {
            const { isSignUpComplete } = await confirmSignUp({
                username: form.email,
                confirmationCode: form.code
            })

            if (isSignUpComplete) {
                await signIn({ username: form.email, password: form.password })
                const { userId } = await getCurrentUser()
                const session = await fetchAuthSession()
                const token = session.tokens.accessToken.toString()

                const res = await fetch(`${API_BASE}/api/v1/miles/members`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        email: form.email,
                        first_name: form.first_name,
                        last_name: form.last_name,
                        phone: '',
                        user_id: userId
                    })
                })

                if (res.ok) {
                    const data = await res.json()
                    setMilesUser(data.member)
                    setConfirming(false)
                    setMode('login')
                } else {
                    throw new Error('Failed to create member record')
                }
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="miles-page">
            <div className="miles-container">
                <h1>Fly with Bilet Member Club</h1>

                {milesUser ? (
                    <div className="profile-card" style={{ textAlign: 'center' }}>
                        <h2>{milesUser.first_name} {milesUser.last_name}</h2>
                        <div className="member-number-box">
                            <span className="label">Membership Number</span>
                            <span className="value">{milesUser.member_number}</span>
                        </div>
                        <div className="stats-row">
                            <div className="stat-box points">
                                <span className="label">Total Points</span>
                                <span className="value">{(milesUser.total_points || 0).toLocaleString()}</span>
                            </div>
                        </div>
                        <div className="profile-actions">
                            <button className="btn btn-primary" onClick={() => navigate('/')}>New Booking</button>
                            <button className="btn btn-secondary" onClick={onLogout}>Sign Out</button>
                        </div>

                        {/* Rezervasyon Listesi */}
                        {bookings.length > 0 && (
                            <div style={{ marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                                <h3>My Flights</h3>
                                <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                                    <table style={{ width: '100%', textAlign: 'left', marginTop: '1rem', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid #ddd' }}>
                                                <th style={{ padding: '0.5rem' }}>Flight</th>
                                                <th style={{ padding: '0.5rem' }}>Route</th>
                                                <th style={{ padding: '0.5rem' }}>Date</th>
                                                <th style={{ padding: '0.5rem' }}>Ref</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {bookings.map(b => (
                                                <tr key={b.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                                                    <td style={{ padding: '0.5rem' }}>{b.flight_number}</td>
                                                    <td style={{ padding: '0.5rem' }}>{b.origin} → {b.destination}</td>
                                                    <td style={{ padding: '0.5rem' }}>{new Date(b.departure_time).toLocaleDateString()}</td>
                                                    <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{b.booking_reference}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="auth-card">
                        {!confirming ? (
                            <>
                                <div className="auth-tabs">
                                    <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>Login</button>
                                    <button className={`tab ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>Register</button>
                                </div>
                                {error && <div className="alert alert-error">{error}</div>}
                                <form onSubmit={mode === 'login' ? handleLogin : handleRegister}>
                                    {mode === 'register' && (
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>First Name</label>
                                                <input type="text" value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} required />
                                            </div>
                                            <div className="form-group">
                                                <label>Last Name</label>
                                                <input type="text" value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} required />
                                            </div>
                                        </div>
                                    )}
                                    <div className="form-group">
                                        <label>Email</label>
                                        <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
                                    </div>

                                    <div className="form-group">
                                        <label>Password</label>
                                        <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
                                    </div>
                                    <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                                        {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
                                    </button>
                                </form>
                            </>
                        ) : (
                            <>
                                <h2>Verify Email</h2>
                                <p>Please enter the code sent to {form.email}</p>
                                {error && <div className="alert alert-error">{error}</div>}
                                <form onSubmit={handleConfirm}>
                                    <div className="form-group">
                                        <label>Confirmation Code</label>
                                        <input type="text" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} required />
                                    </div>
                                    <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                                        {loading ? 'Verifying...' : 'Verify & Login'}
                                    </button>
                                    <button type="button" className="btn btn-text" onClick={() => setConfirming(false)}>Back</button>
                                </form>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

// ANA SAYFA (Uçuş Arama)

function HomePage({ milesUser, setMilesUser }) {
    const [airports, setAirports] = useState([])
    const [flights, setFlights] = useState([])
    const [searched, setSearched] = useState(false)
    const [searchParams, setSearchParams] = useState({ from: 'IST', to: 'JFK', date: '2026-01-15', passengers: 1 })
    const navigate = useNavigate()

    useEffect(() => { fetchAirports() }, [])

    const fetchAirports = async () => {
        try {
            const res = await fetch(`${FLIGHT_API_BASE}/api/v1/flights/airports`)
            const data = await res.json()
            setAirports(data.airports || [])
        } catch (err) {
            console.error('Failed to fetch airports:', err)
        }
    }

    const handleSearch = async (e) => {
        e.preventDefault()
        try {
            const query = new URLSearchParams(searchParams).toString()
            const res = await fetch(`${FLIGHT_API_BASE}/api/v1/flights/search?${query}`)
            const data = await res.json()
            setFlights(data.flights || [])
            setSearched(true)
        } catch (err) {
            console.error(err)
        }
    }

    return (
        <div className="home-page">
            <div className="hero">
                <h1>Fly with Bilet</h1>
                <form className="search-box" style={{ marginTop: '2rem' }} onSubmit={handleSearch}>
                    <div className="search-grid">
                        <div className="form-group">
                            <label>From</label>
                            <select value={searchParams.from} onChange={e => setSearchParams({ ...searchParams, from: e.target.value })}>
                                {airports.map(a => <option key={a.id} value={a.code}>{a.city} ({a.code})</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>To</label>
                            <select value={searchParams.to} onChange={e => setSearchParams({ ...searchParams, to: e.target.value })}>
                                {airports.map(a => <option key={a.id} value={a.code}>{a.city} ({a.code})</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Date</label>
                            <input type="date" value={searchParams.date} onChange={e => setSearchParams({ ...searchParams, date: e.target.value })} />
                        </div>
                        <button type="submit" className="btn btn-primary" style={{ height: '48px' }}>Search</button>
                    </div>
                </form>
            </div>

            <div className="results-section">
                {searched && (
                    <div className="results-container">
                        <h2 style={{ textAlign: 'left', fontSize: '1.25rem', marginBottom: '1.5rem' }}>{flights.length} Flights Available</h2>
                        {flights.map(flight => (
                            <div key={flight.id} className="flight-card">
                                <div className="airline-logo" style={{ fontWeight: 'bold' }}>{flight.flight_number}</div>
                                <div className="flight-route">
                                    <div className="time">{new Date(flight.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#999', margin: '0 1rem' }}>→</div>
                                    <div className="time">{new Date(flight.arrival_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                </div>
                                <div className="duration" style={{ color: '#888', fontSize: '0.9rem' }}>
                                    {Math.floor(flight.duration_minutes / 60)}h {flight.duration_minutes % 60}m
                                    <div style={{ marginTop: '0.3rem', fontSize: '0.85rem', color: flight.available_capacity < 10 ? '#f59e0b' : '#10b981' }}>
                                        {flight.available_capacity} seats left
                                    </div>
                                </div>
                                <div className="price-action">
                                    <div className="price">${flight.base_price}</div>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ marginTop: '0.5rem' }}
                                        onClick={() => navigate('/book', { state: { flight } })}
                                    >
                                        Select
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default App
