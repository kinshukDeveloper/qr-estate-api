const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // SSL: off for local dev (DB_SSL=false), on for Neon/production
  ssl: process.env.DB_SSL === 'false'
    ? false
    : { rejectUnauthorized: false },

  max: parseInt(process.env.DB_POOL_MAX) || 3,
  min: 0,
  idleTimeoutMillis:        parseInt(process.env.DB_IDLE_TIMEOUT)    || 10_000,
  connectionTimeoutMillis:  parseInt(process.env.DB_CONNECT_TIMEOUT) || 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('New DB client connected');
  }
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error:', err);
});

async function connectDB() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as time, current_database() as db');
    logger.info(`✅ DB connected — ${result.rows[0].db}`);
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 200) {
      logger.warn(`Slow query (${duration}ms): ${text.substring(0, 80)}`);
    }
    return result;
  } catch (err) {
    logger.error('DB query error:', { query: text, error: err.message });
    throw err;
  }
}

async function getClient() {
  return pool.connect();
}

module.exports = { connectDB, query, getClient, pool };
