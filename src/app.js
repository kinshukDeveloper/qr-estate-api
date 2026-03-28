require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const logger = require('./config/logger');
const { pool } = require('./config/database');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

// ── TRUST PROXY (required for Vercel) ─────────────────────────────────────────
app.set('trust proxy', 1);

// ── REQUEST ID ─────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ── SECURITY HEADERS ───────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
}));
app.disable('x-powered-by');

// ── CORS ───────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // Postman / curl
    if (allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn(`CORS blocked: ${origin}`);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
}));

// ── COMPRESSION + BODY PARSING ─────────────────────────────────────────────────
app.use(compression({ level: 6 }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── LOGGING ────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.url === '/health',
  }));
}

// ── RATE LIMITING ──────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 100,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many requests.' },
});

app.use('/api', globalLimiter);
app.use(`/api/${process.env.API_VERSION || 'v1'}/auth/login`, authLimiter);
app.use(`/api/${process.env.API_VERSION || 'v1'}/auth/register`, authLimiter);
app.use(`/api/${process.env.API_VERSION || 'v1'}/p/`, publicLimiter);

// ── HEALTH CHECK ───────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const checks = { api: 'ok', db: 'unknown', redis: 'unknown' };

  try {
    await pool.query('SELECT 1');
    checks.db = 'ok';
  } catch {
    checks.db = 'error';
  }

  try {
    const { getRedis } = require('./config/redis');
    const redisClient = getRedis();
    checks.redis = redisClient?.status === 'ready' ? 'ok' : 'degraded';
  } catch {
    checks.redis = 'degraded';
  }

  const isHealthy = checks.db === 'ok';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    app: process.env.APP_NAME || 'QR Estate API',
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV,
    checks,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ── API ROUTES ─────────────────────────────────────────────────────────────────
app.use(`/api/${process.env.API_VERSION || 'v1'}`, routes);

// ── QR SHORT CODE REDIRECT ─────────────────────────────────────────────────────
const { redirectQR } = require('./controllers/qrController');
app.get('/q/:shortCode', redirectQR);

// ── 404 & ERROR ────────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
