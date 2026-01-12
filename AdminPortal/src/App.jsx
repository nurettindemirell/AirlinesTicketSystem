import { useState, useEffect } from 'react'
import { getCurrentUser, signIn, signOut, fetchAuthSession, confirmSignIn } from 'aws-amplify/auth'

const API_BASE = 'http://localhost:3000'

function App() {
    const [user, setUser] = useState(null)
    const [view, setView] = useState('flights')
    const [loading, setLoading] = useState(true)
    const [refreshKey, setRefreshKey] = useState(0)

    useEffect(() => {
        checkAuth()
    }, [])

    const checkAuth = async () => {
        try {
            const currentUser = await getCurrentUser()
            // Check for valid session
            await fetchAuthSession()
            setUser(currentUser)
        } catch (err) {
            setUser(null)
        } finally {
            setLoading(false)
        }
    }

    const handleLogin = async (userData) => {
        setUser(userData)
    }

    const handleLogout = async () => {
        await signOut()
        setUser(null)
    }

    if (loading) {
        return <div className="loading">Loading...</div>
    }

    if (!user) {
        return <LoginPage onLogin={handleLogin} />
    }

    return (
        <div className="dashboard">
            <Sidebar view={view} setView={setView} onLogout={handleLogout} user={user} />
            <main className="main-content">
                {view === 'flights' && <FlightsPage key={`flights-${refreshKey}`} view={view} refreshKey={refreshKey} />}
                {view === 'add-flight' && <AddFlightPage setView={(newView) => {
                    if (newView === 'flights') {
                        setRefreshKey(prev => prev + 1)
                    }
                    setView(newView)
                }} />}
            </main>
        </div>
    )
}

// Login Page Component
function LoginPage({ onLogin }) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [step, setStep] = useState('LOGIN') // 'LOGIN' or 'NEW_PASSWORD'

    const checkAdminAndLogin = async () => {
        const user = await getCurrentUser()
        const session = await fetchAuthSession()
        const groups = session.tokens?.accessToken?.payload['cognito:groups'] || []

        if (!groups.includes('ADMIN')) {
            await signOut()
            throw new Error('Access denied. ADMIN role required. Please ask an administrator to add you to the ADMIN group in Cognito.')
        }

        onLogin(user)
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            if (step === 'LOGIN') {
                const { isSignedIn, nextStep } = await signIn({ username: email, password })

                if (isSignedIn) {
                    await checkAdminAndLogin()
                } else if (nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
                    setStep('NEW_PASSWORD')
                    setError('Temporary password. Please set a new permanent password.')
                } else {
                    console.log('Next step:', nextStep)
                }
            } else if (step === 'NEW_PASSWORD') {
                const { isSignedIn } = await confirmSignIn({ challengeResponse: newPassword })
                if (isSignedIn) {
                    await checkAdminAndLogin()
                }
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="login-page">
            <div className="login-card">
                <h1>Administration</h1>
                <p className="login-subtitle">System Access</p>

                {error && <div className={`alert ${step === 'NEW_PASSWORD' ? 'alert-warning' : 'alert-error'}`}>{error}</div>}

                <form onSubmit={handleSubmit}>
                    {step === 'LOGIN' ? (
                        <>
                            <div className="form-group">
                                <label>Username</label>
                                <input
                                    type="text"
                                    placeholder="Enter your username"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Password</label>
                                <input
                                    type="password"
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </>
                    ) : (
                        <div className="form-group">
                            <label>New Password</label>
                            <input
                                type="password"
                                placeholder="Set your new permanent password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                minLength={8}
                            />
                            <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                                Must be at least 8 characters.
                            </p>
                        </div>
                    )}

                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
                        {loading ? 'Processing...' : (step === 'LOGIN' ? 'LOGIN' : 'SET NEW PASSWORD')}
                    </button>

                    {step === 'NEW_PASSWORD' && (
                        <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ width: '100%', marginTop: '1rem' }}
                            onClick={() => { setStep('LOGIN'); setPassword(''); setError(''); }}
                        >
                            Back to Login
                        </button>
                    )}
                </form>
            </div>
        </div>
    )
}

// Sidebar Component
function Sidebar({ view, setView, onLogout, user }) {
    return (
        <aside className="sidebar">
            <div className="sidebar-logo">
                Flight Control
            </div>
            <nav>
                <ul className="sidebar-nav">
                    <li>
                        <a
                            href="#"
                            className={view === 'flights' ? 'active' : ''}
                            onClick={(e) => { e.preventDefault(); setView('flights') }}
                        >
                            Flights Overview
                        </a>
                    </li>
                    <li>
                        <a
                            href="#"
                            className={view === 'add-flight' ? 'active' : ''}
                            onClick={(e) => { e.preventDefault(); setView('add-flight') }}
                        >
                            Add New Flight
                        </a>
                    </li>
                    <li style={{ marginTop: 'auto', paddingTop: '2rem' }}>
                        <button onClick={onLogout}>
                            Sign Out
                        </button>
                    </li>
                </ul>
            </nav>
            <div style={{ marginTop: 'auto', paddingTop: '2rem', fontSize: '0.875rem', color: '#64748b' }}>
                Logged in as: {user?.username}
            </div>
        </aside>
    )
}


// Flights List Page
function FlightsPage({ view, refreshKey }) {
    const [allFlights, setAllFlights] = useState([]) // Store all flights
    const [flights, setFlights] = useState([]) // Filtered flights
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 })

    // Search and filter states
    const [searchTerm, setSearchTerm] = useState('')
    const [filterOrigin, setFilterOrigin] = useState('')
    const [filterDestination, setFilterDestination] = useState('')
    const [filterStatus, setFilterStatus] = useState('')
    const [filterDateFrom, setFilterDateFrom] = useState('')
    const [filterDateTo, setFilterDateTo] = useState('')
    const [sortBy, setSortBy] = useState('departure_time')
    const [sortOrder, setSortOrder] = useState('asc')
    const [airports, setAirports] = useState([])

    // Fetch airports for filter dropdowns
    useEffect(() => {
        fetchAirports()
    }, [])

    // Fetch flights when component mounts, view changes, or refreshKey changes
    useEffect(() => {
        console.log('🔄 FlightsPage: Fetching flights (refreshKey:', refreshKey, ')')
        fetchFlights()
    }, [refreshKey])

    // Apply filters whenever search/filter states change
    useEffect(() => {
        applyFilters()
    }, [searchTerm, filterOrigin, filterDestination, filterStatus, filterDateFrom, filterDateTo, sortBy, sortOrder, allFlights])

    const fetchAirports = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/v1/flights/airports`)
            const data = await res.json()
            setAirports(data.airports || [])
        } catch (err) {
            console.error('Failed to fetch airports:', err)
        }
    }

    const fetchFlights = async () => {
        setLoading(true)
        setError('')
        try {
            const session = await fetchAuthSession()
            const accessToken = session.tokens?.accessToken?.toString()

            if (!accessToken) {
                throw new Error('No access token available')
            }

            // Add cache-busting timestamp and high limit to get all flights
            const timestamp = Date.now()
            const res = await fetch(`${API_BASE}/api/v1/admin/flights?limit=1000&page=1&t=${timestamp}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Cache-Control': 'no-cache'
                },
                cache: 'no-store'
            })

            const data = await res.json()

            if (!res.ok) throw new Error(data.error || 'Failed to fetch flights')

            console.log('📥 Flights API Response:', {
                flightsCount: data.flights?.length || 0,
                total: data.pagination?.total || 0,
                page: data.pagination?.page || 1,
                totalPages: data.pagination?.totalPages || 1,
                hasFlights: !!data.flights && data.flights.length > 0,
                sampleFlight: data.flights?.[0]?.flight_number || 'none'
            })

            if (data.flights && data.flights.length > 0) {
                console.log(`✅ Successfully loaded ${data.flights.length} flights (Total: ${data.pagination?.total || 0})`)
            } else {
                console.warn('⚠️  No flights in response')
            }

            const fetchedFlights = data.flights || []
            setAllFlights(fetchedFlights) // Store all flights
            setPagination(data.pagination || { total: 0, page: 1, totalPages: 1 })
            // applyFilters will be called by useEffect to filter the flights
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const applyFilters = () => {
        let filtered = [...allFlights]

        // Search filter (flight number, origin, destination)
        if (searchTerm) {
            const term = searchTerm.toLowerCase()
            filtered = filtered.filter(flight =>
                flight.flight_number?.toLowerCase().includes(term) ||
                flight.origin?.code?.toLowerCase().includes(term) ||
                flight.origin?.city?.toLowerCase().includes(term) ||
                flight.destination?.code?.toLowerCase().includes(term) ||
                flight.destination?.city?.toLowerCase().includes(term)
            )
        }

        // Origin filter
        if (filterOrigin) {
            filtered = filtered.filter(flight =>
                flight.origin?.code === filterOrigin
            )
        }

        // Destination filter
        if (filterDestination) {
            filtered = filtered.filter(flight =>
                flight.destination?.code === filterDestination
            )
        }

        // Status filter
        if (filterStatus) {
            filtered = filtered.filter(flight =>
                flight.status === filterStatus
            )
        }

        // Date range filter
        if (filterDateFrom) {
            const fromDate = new Date(filterDateFrom)
            filtered = filtered.filter(flight => {
                const depDate = new Date(flight.departure_time)
                return depDate >= fromDate
            })
        }

        if (filterDateTo) {
            const toDate = new Date(filterDateTo)
            toDate.setHours(23, 59, 59, 999) // Include entire day
            filtered = filtered.filter(flight => {
                const depDate = new Date(flight.departure_time)
                return depDate <= toDate
            })
        }

        // Sorting
        filtered.sort((a, b) => {
            let aVal, bVal

            switch (sortBy) {
                case 'flight_number':
                    aVal = a.flight_number || ''
                    bVal = b.flight_number || ''
                    break
                case 'departure_time':
                    aVal = new Date(a.departure_time).getTime()
                    bVal = new Date(b.departure_time).getTime()
                    break
                case 'price':
                    aVal = a.predicted_price || 0
                    bVal = b.predicted_price || 0
                    break
                case 'capacity':
                    aVal = a.available_capacity || 0
                    bVal = b.available_capacity || 0
                    break
                case 'route':
                    aVal = `${a.origin?.code || ''}-${a.destination?.code || ''}`
                    bVal = `${b.origin?.code || ''}-${b.destination?.code || ''}`
                    break
                default:
                    aVal = new Date(a.departure_time).getTime()
                    bVal = new Date(b.departure_time).getTime()
            }

            if (sortOrder === 'asc') {
                return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
            } else {
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0
            }
        })

        setFlights(filtered)
    }

    const clearFilters = () => {
        setSearchTerm('')
        setFilterOrigin('')
        setFilterDestination('')
        setFilterStatus('')
        setFilterDateFrom('')
        setFilterDateTo('')
        setSortBy('departure_time')
        setSortOrder('asc')
    }

    if (loading) return <div className="loading">Loading flights...</div>

    return (
        <div>
            <div className="page-header">
                <h1>Flights List</h1>
                {pagination.total > 0 && (
                    <p className="text-muted">
                        Showing {flights.length} of {allFlights.length} flights
                        {allFlights.length !== pagination.total && ` (${pagination.total} total in database)`}
                    </p>
                )}
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {/* Search and Filter Section */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>🔍 Search & Filter</h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    {/* Search Input */}
                    <div className="form-group">
                        <label>Search</label>
                        <input
                            type="text"
                            placeholder="Flight number, origin, destination..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ width: '100%' }}
                        />
                    </div>

                    {/* Origin Filter */}
                    <div className="form-group">
                        <label>Origin</label>
                        <select
                            value={filterOrigin}
                            onChange={(e) => setFilterOrigin(e.target.value)}
                            style={{ width: '100%' }}
                        >
                            <option value="">All Origins</option>
                            {airports.map(airport => (
                                <option key={airport.code} value={airport.code}>
                                    {airport.code} - {airport.city}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Destination Filter */}
                    <div className="form-group">
                        <label>Destination</label>
                        <select
                            value={filterDestination}
                            onChange={(e) => setFilterDestination(e.target.value)}
                            style={{ width: '100%' }}
                        >
                            <option value="">All Destinations</option>
                            {airports.map(airport => (
                                <option key={airport.code} value={airport.code}>
                                    {airport.code} - {airport.city}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Status Filter */}
                    <div className="form-group">
                        <label>Status</label>
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            style={{ width: '100%' }}
                        >
                            <option value="">All Status</option>
                            <option value="SCHEDULED">SCHEDULED</option>
                            <option value="DELAYED">DELAYED</option>
                            <option value="CANCELLED">CANCELLED</option>
                            <option value="COMPLETED">COMPLETED</option>
                        </select>
                    </div>

                    {/* Date From */}
                    <div className="form-group">
                        <label>Date From</label>
                        <input
                            type="date"
                            value={filterDateFrom}
                            onChange={(e) => setFilterDateFrom(e.target.value)}
                            style={{ width: '100%' }}
                        />
                    </div>

                    {/* Date To */}
                    <div className="form-group">
                        <label>Date To</label>
                        <input
                            type="date"
                            value={filterDateTo}
                            onChange={(e) => setFilterDateTo(e.target.value)}
                            style={{ width: '100%' }}
                        />
                    </div>

                    {/* Sort By */}
                    <div className="form-group">
                        <label>Sort By</label>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            style={{ width: '100%' }}
                        >
                            <option value="departure_time">Departure Time</option>
                            <option value="flight_number">Flight Number</option>
                            <option value="price">Price</option>
                            <option value="capacity">Available Capacity</option>
                            <option value="route">Route</option>
                        </select>
                    </div>

                    {/* Sort Order */}
                    <div className="form-group">
                        <label>Order</label>
                        <select
                            value={sortOrder}
                            onChange={(e) => setSortOrder(e.target.value)}
                            style={{ width: '100%' }}
                        >
                            <option value="asc">Ascending</option>
                            <option value="desc">Descending</option>
                        </select>
                    </div>
                </div>

                {/* Clear Filters Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                        className="btn"
                        onClick={clearFilters}
                        style={{ backgroundColor: '#6c757d', color: 'white' }}
                    >
                        Clear Filters
                    </button>
                </div>
            </div>

            <div className="card">
                <table className="flights-table">
                    <thead>
                        <tr>
                            <th>
                                Flight No
                                <button
                                    onClick={() => {
                                        setSortBy('flight_number')
                                        setSortOrder(sortBy === 'flight_number' && sortOrder === 'asc' ? 'desc' : 'asc')
                                    }}
                                    style={{ marginLeft: '5px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8em' }}
                                    title="Sort by Flight Number"
                                >
                                    {sortBy === 'flight_number' ? (sortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                </button>
                            </th>
                            <th>
                                Route
                                <button
                                    onClick={() => {
                                        setSortBy('route')
                                        setSortOrder(sortBy === 'route' && sortOrder === 'asc' ? 'desc' : 'asc')
                                    }}
                                    style={{ marginLeft: '5px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8em' }}
                                    title="Sort by Route"
                                >
                                    {sortBy === 'route' ? (sortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                </button>
                            </th>
                            <th>
                                Departure
                                <button
                                    onClick={() => {
                                        setSortBy('departure_time')
                                        setSortOrder(sortBy === 'departure_time' && sortOrder === 'asc' ? 'desc' : 'asc')
                                    }}
                                    style={{ marginLeft: '5px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8em' }}
                                    title="Sort by Departure Time"
                                >
                                    {sortBy === 'departure_time' ? (sortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                </button>
                            </th>
                            <th>Duration</th>
                            <th>
                                Capacity
                                <button
                                    onClick={() => {
                                        setSortBy('capacity')
                                        setSortOrder(sortBy === 'capacity' && sortOrder === 'asc' ? 'desc' : 'asc')
                                    }}
                                    style={{ marginLeft: '5px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8em' }}
                                    title="Sort by Capacity"
                                >
                                    {sortBy === 'capacity' ? (sortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                </button>
                            </th>
                            <th>
                                Price
                                <button
                                    onClick={() => {
                                        setSortBy('price')
                                        setSortOrder(sortBy === 'price' && sortOrder === 'asc' ? 'desc' : 'asc')
                                    }}
                                    style={{ marginLeft: '5px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8em' }}
                                    title="Sort by Price"
                                >
                                    {sortBy === 'price' ? (sortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                </button>
                            </th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {flights.length === 0 ? (
                            <tr>
                                <td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>
                                    {allFlights.length === 0
                                        ? 'No flights found. Add a new flight!'
                                        : 'No flights match your filters. Try adjusting your search criteria.'
                                    }
                                </td>
                            </tr>
                        ) : (
                            flights.map(flight => (
                                <tr key={flight.id}>
                                    <td><strong>{flight.flight_number}</strong></td>
                                    <td>{flight.origin?.code} → {flight.destination?.code}</td>
                                    <td>{new Date(flight.departure_time).toLocaleString()}</td>
                                    <td>{flight.duration_minutes} min</td>
                                    <td>{flight.available_capacity}/{flight.total_capacity}</td>
                                    <td>${flight.predicted_price}</td>
                                    <td>
                                        <span className={`badge ${flight.status === 'SCHEDULED' ? 'badge-success' : 'badge-warning'}`}>
                                            {flight.status}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// Add Flight Page
function AddFlightPage({ setView }) {
    const [airports, setAirports] = useState([])
    const [form, setForm] = useState({
        flight_number: '',
        origin_airport_code: '',
        destination_airport_code: '',
        departure_time: '',
        arrival_time: '',
        total_capacity: '',
        base_price: '',
        is_direct: true
    })
    const [prediction, setPrediction] = useState(null)
    const [loading, setLoading] = useState(false)
    const [predicting, setPredicting] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    useEffect(() => {
        fetchAirports()
    }, [])

    const fetchAirports = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/v1/flights/airports`)
            const data = await res.json()
            setAirports(data.airports || [])
        } catch (err) {
            console.error('Failed to fetch airports:', err)
        }
    }

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target
        setForm(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }))
    }

    const calculateDuration = () => {
        if (form.departure_time && form.arrival_time) {
            const dep = new Date(form.departure_time)
            const arr = new Date(form.arrival_time)
            return Math.round((arr - dep) / (1000 * 60))
        }
        return 0
    }

    const handlePredict = async () => {
        console.log('🎯 handlePredict called')

        const duration = calculateDuration()
        console.log('⏱️ Calculated duration:', duration)

        if (!form.origin_airport_code || !form.destination_airport_code || !form.departure_time || duration <= 0) {
            setError('Please fill in origin, destination, departure and arrival times first')
            return
        }

        console.log('✅ Starting prediction...')
        setPredicting(true)
        setError('')
        setPrediction(null)

        // Safety timeout
        let safetyTimeout
        try {
            safetyTimeout = setTimeout(() => {
                console.error('⚠️ Safety timeout triggered - forcing setPredicting(false)')
                setPredicting(false)
                setError('Request took too long. Please try again.')
            }, 20000)
        } catch (timeoutError) {
            console.error('Failed to set safety timeout:', timeoutError)
        }

        try {
            const session = await fetchAuthSession()
            const accessToken = session.tokens?.accessToken?.toString()

            if (!accessToken) {
                throw new Error('No access token available. Please login again.')
            }

            // Convert datetime-local to ISO format
            const departureISO = form.departure_time ? new Date(form.departure_time).toISOString() : null

            if (!departureISO || isNaN(new Date(departureISO).getTime())) {
                throw new Error('Invalid departure time format')
            }

            console.log('Predicting price with:', {
                origin_airport_code: form.origin_airport_code,
                destination_airport_code: form.destination_airport_code,
                departure_time: departureISO,
                duration_minutes: duration,
                is_direct: form.is_direct,
                base_price: form.base_price,
                api_base: API_BASE
            })

            // Make API call with timeout
            const requestBody = {
                origin_airport_code: form.origin_airport_code,
                destination_airport_code: form.destination_airport_code,
                departure_time: departureISO,
                duration_minutes: duration,
                is_direct: form.is_direct,
                base_price: form.base_price || null
            };

            console.log('🚀 Making fetch request to:', `${API_BASE}/api/v1/admin/predict-price`)
            console.log('📦 Request body:', requestBody)
            console.log('🔑 Has token:', !!session?.access_token)
            console.log('🔑 Token preview:', session?.access_token?.substring(0, 20) + '...')

            // Create AbortController for timeout
            const controller = new AbortController()
            const timeoutId = setTimeout(() => {
                console.error('⏱️ Request timeout after 15 seconds')
                controller.abort()
            }, 15000) // 15 second timeout

            let res
            try {
                res = await fetch(`${API_BASE}/api/v1/admin/predict-price`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                })
                clearTimeout(timeoutId)
                console.log('📥 Response received - Status:', res.status, res.statusText)
            } catch (fetchError) {
                clearTimeout(timeoutId)
                if (fetchError.name === 'AbortError') {
                    throw new Error('Request timeout. The server took too long to respond. Please try again.')
                }
                if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('NetworkError')) {
                    throw new Error('Network error. Please check if the server is running and try again.')
                }
                throw new Error(`Request failed: ${fetchError.message}`)
            }

            if (!res) {
                throw new Error('No response received from server')
            }

            // Check response status first
            if (!res.ok) {
                const errorText = await res.text()
                let errorData
                try {
                    errorData = JSON.parse(errorText)
                } catch {
                    errorData = { error: errorText || `Server error: ${res.status}` }
                }
                console.error('❌ Server error:', res.status, errorData)
                throw new Error(errorData.error || errorData.message || `Server error: ${res.status}`)
            }

            // Parse successful response
            const responseText = await res.text()
            console.log('📄 Raw response text:', responseText)

            let data
            try {
                data = JSON.parse(responseText)
                console.log('✅ Parsed response:', data)
            } catch (jsonError) {
                console.error('❌ JSON parse error:', jsonError)
                console.error('Response text that failed to parse:', responseText)
                throw new Error(`Invalid JSON response from server: ${jsonError.message}`)
            }

            // Validate response structure
            if (!data.prediction) {
                console.error('❌ Missing prediction in response:', data)
                throw new Error('Response missing prediction field')
            }

            if (data.prediction.predictedPrice === undefined || data.prediction.predictedPrice === null) {
                console.error('❌ Missing predictedPrice in response:', data.prediction)
                throw new Error('Response missing predictedPrice field')
            }

            // Success!
            console.log('✅ Prediction successful:', data.prediction.predictedPrice)
            setPrediction(data.prediction)
            setForm(prev => ({ ...prev, base_price: data.prediction.predictedPrice.toString() }))
        } catch (err) {
            console.error('❌ Prediction error:', err)
            console.error('Error stack:', err.stack)
            console.error('Error name:', err.name)
            setError(err.message || 'Failed to predict price. Please try again.')
            setPrediction(null)
        } finally {
            if (safetyTimeout) {
                clearTimeout(safetyTimeout)
            }
            console.log('🔄 Finally block - setting predicting to false')
            setPredicting(false)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        setSuccess('')

        try {
            const session = await fetchAuthSession()
            const accessToken = session.tokens?.accessToken?.toString()

            if (!accessToken) {
                throw new Error('No access token available. Please login again.')
            }

            const res = await fetch(`${API_BASE}/api/v1/admin/flights`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    ...form,
                    total_capacity: parseInt(form.total_capacity),
                    base_price: parseFloat(form.base_price)
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to create flight')

            console.log('✅ Flight created successfully:', data)
            setSuccess('Flight created successfully!')
            setForm({
                flight_number: '',
                origin_airport_code: '',
                destination_airport_code: '',
                departure_time: '',
                arrival_time: '',
                total_capacity: '',
                base_price: '',
                is_direct: true
            })
            setPrediction(null)

            // Navigate back to flights list - key change will force remount and refresh
            setTimeout(() => {
                console.log('🔄 Navigating to flights list')
                setView('flights')
            }, 1000) // Show success message for 1 second
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div>
            <div className="page-header">
                <h1>Add Flight</h1>
            </div>

            <div className="card flight-entry-form">
                <div className="card-title">Flight Details</div>

                {error && <div className="alert alert-error">{error}</div>}
                {success && <div className="alert alert-success">{success}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-row">
                        <div className="form-group">
                            <label>From City</label>
                            <select name="origin_airport_code" value={form.origin_airport_code} onChange={handleChange} required>
                                <option value="">Select departure city</option>
                                {airports.map(a => (
                                    <option key={a.id} value={a.code}>{a.city} ({a.code})</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>To City</label>
                            <select name="destination_airport_code" value={form.destination_airport_code} onChange={handleChange} required>
                                <option value="">Select destination city</option>
                                {airports.map(a => (
                                    <option key={a.id} value={a.code}>{a.city} ({a.code})</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Departure Time</label>
                            <input type="datetime-local" name="departure_time" value={form.departure_time} onChange={handleChange} required />
                        </div>
                        <div className="form-group">
                            <label>Arrival Time</label>
                            <input type="datetime-local" name="arrival_time" value={form.arrival_time} onChange={handleChange} required />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Flight Code</label>
                            <input type="text" name="flight_number" placeholder="e.g., TK123" value={form.flight_number} onChange={handleChange} required />
                        </div>
                        <div className="form-group">
                            <label>Capacity</label>
                            <input type="number" name="total_capacity" placeholder="e.g., 180" value={form.total_capacity} onChange={handleChange} required />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Duration</label>
                        <input type="text" value={calculateDuration() > 0 ? `${calculateDuration()} minutes` : 'Set departure and arrival times'} disabled />
                    </div>

                    <div className="price-row">
                        <div className="form-group">
                            <label>Price ($)</label>
                            <input type="number" name="base_price" placeholder="e.g., $299" value={form.base_price} onChange={handleChange} step="0.01" required />
                        </div>
                        <button type="button" className="btn btn-predict" onClick={handlePredict} disabled={predicting || loading}>
                            {predicting ? 'Calculating...' : 'Predict Price'}
                        </button>
                    </div>

                    {error && (
                        <div className="alert alert-error" style={{ marginTop: '1rem', padding: '1rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px' }}>
                            ⚠️ {error}
                        </div>
                    )}

                    {prediction && (
                        <div className="prediction-result" style={{
                            marginTop: '1rem',
                            padding: '1.5rem',
                            background: '#f0fdf4',
                            border: '2px solid #22c55e',
                            borderRadius: '12px',
                            textAlign: 'center'
                        }}>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#16a34a', marginBottom: '0.5rem' }}>
                                ${prediction.predictedPrice?.toFixed(2) || prediction.predictedPrice}
                            </div>
                            <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                                Confidence: {Math.round((prediction.confidence || 0.85) * 100)}%
                            </div>
                        </div>
                    )}

                    {predicting && (
                        <div style={{ marginTop: '1rem', textAlign: 'center', color: '#64748b' }}>
                            Calculating optimal price...
                        </div>
                    )}

                    <div className="form-group checkbox-group">
                        <input type="checkbox" name="is_direct" checked={form.is_direct} onChange={handleChange} id="is_direct" />
                        <label htmlFor="is_direct">Direct Flight</label>
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '1rem' }}>
                        {loading ? 'Saving...' : 'SAVE'}
                    </button>
                </form>
            </div>
        </div>
    )
}

export default App
