require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS middleware (Sadece CORS için, body parsing yok proxy rotalarında)
app.use(cors());

// Servis Adresleri (URL'leri)
const FLIGHT_SERVICE_URL = process.env.FLIGHT_SERVICE_URL || 'http://localhost:3001';
const MILES_SERVICE_URL = process.env.MILES_SERVICE_URL || 'http://localhost:3002';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3003';

// Sağlık kontrolü (burada body parsing lazım olabilir)
app.get('/health', express.json(), (req, res) => {
  res.json({ status: 'ok', service: 'gateway', timestamp: new Date().toISOString() });
});

// Proxy ayarları (Yönlendirme yardımcısı fonksiyon)
const createProxy = (target, pathPrefix) => createProxyMiddleware({
  target,
  changeOrigin: true,
  timeout: 120000, // 2 minutes for complex searches
  proxyTimeout: 30000,
  onError: (err, req, res) => {
    console.error(`Proxy error for ${pathPrefix}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Service unavailable',
        message: `Backend service at ${target} is not responding`,
        details: err.message
      });
    }
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[Gateway] ${req.method} ${req.originalUrl} -> ${target}${req.url}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[Gateway] Response: ${proxyRes.statusCode} for ${req.originalUrl}`);
  }
});

// Proxy rotaları - Admin işlemleri (flight-service'e gider)
app.use('/api/v1/admin', createProxy(FLIGHT_SERVICE_URL, '/api/v1/admin'));

// Proxy routes - Flight search endpoints (FlighService)
app.use('/api/v1/flights', createProxy(FLIGHT_SERVICE_URL, '/api/v1/flights'));

// Proxy routes - Ticket endpoints (FlightService)
app.use('/api/v1/tickets', createProxy(FLIGHT_SERVICE_URL, '/api/v1/tickets'));

// Proxy routes - Bookings endpoints (FlightService)
app.use('/api/v1/bookings', createProxy(FLIGHT_SERVICE_URL, '/api/v1/bookings'));

// Proxy rotaları - Mil işlemleri (miles-service'e gider)
app.use('/api/v1/miles', createProxy(MILES_SERVICE_URL, '/api/v1/miles'));

// Proxy routes - Notification endpoints (MessagingService)
app.use('/api/v1/notifications', createProxy(NOTIFICATION_SERVICE_URL, '/api/v1/notifications'));

// 404 Hatası (Eşleşmeyen tüm rotalar için)
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

app.listen(PORT, () => {
  console.log('🚀 API Gateway running on http://localhost:' + PORT);
  console.log('   Proxying to:');
  console.log('   - Flight Service: ' + FLIGHT_SERVICE_URL);
  console.log('   - Miles Service: ' + MILES_SERVICE_URL);
  console.log('   - Notification Service: ' + NOTIFICATION_SERVICE_URL);
});
