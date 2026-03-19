const { Pool } = require('pg');
const logger = require('./logger');

/**
 * Neon DB / Vercel Serverless configuration
 *
 * Key changes from the local dev config:
 *  - SSL is always on (Neon requires it)
 *  - Pool max is small (3) — serverless functions are short-lived;
 *    a large pool wastes Neon connection slots
 *  - idleTimeoutMillis is low so connections are released quickly
 *    between invocations
 *  - DATABASE_URL is the only required env var (Neon provides it)
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Neon always requires SSL — rejectUnauthorized:false lets self-signed
  // certs through (Neon's certs are valid, but this avoids cert-chain issues
  // in some Node runtimes).
  ssl: {
    rejectUnauthorized: false,
  },

  // Serverless-friendly pool settings
  max: parseInt(process.env.DB_POOL_MAX) || 3,
  min: 0,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 10_000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT) || 10_000,

  // Neon pauses idle branches after 5 min; keep-alive avoids stale connections
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('New Neon DB client connected');
  }
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error:', err);
});

/**
 * connectDB — verifies the connection is reachable.
 * Called lazily on first request in the Vercel serverless context.
 */
async function connectDB() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as time, current_database() as db');
    logger.info(`✅ Neon DB connected — ${result.rows[0].db}`);
  } finally {
    client.release();
  }
}

/**
 * query — execute SQL with optional params.
 * Usage: await query('SELECT * FROM users WHERE id = $1', [id])
 */
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

/**
 * getClient — returns a pooled client for use in transactions.
 */
async function getClient() {
  return pool.connect();
}

module.exports = { connectDB, query, getClient, pool };
