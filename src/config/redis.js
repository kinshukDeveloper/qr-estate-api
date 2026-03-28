/**
 * Redis — Upstash-compatible via ioredis
 *
 * On Vercel, use Upstash Redis (https://upstash.com).
 * Set REDIS_URL to your Upstash Redis endpoint:
 *   rediss://default:<password>@<host>.upstash.io:6379
 *
 * The app works without Redis (token blacklisting is skipped),
 * so Redis is optional but strongly recommended for production.
 */
const Redis = require('ioredis');
const logger = require('./logger');

let redis = null;

function connectRedis() {
  return new Promise((resolve) => {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      logger.warn('REDIS_URL not set — running without cache/token blacklist.');
      return resolve(null);
    }

    redis = new Redis(redisUrl, {
      // Upstash requires TLS — ioredis enables it automatically when
      // the scheme is rediss://
      tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,

      retryStrategy: (times) => {
        if (times > 5) {
          logger.warn('Redis: Max reconnect attempts reached. Running without cache.');
          return null; // stop retrying
        }
        return Math.min(times * 100, 2000);
      },

      // Vercel functions may share a Redis connection across warm invocations;
      // lazyConnect lets us control when the connection opens.
      lazyConnect: true,
    });

    redis.on('connect', () => {
      logger.info('✅ Redis (Upstash) connected');
      resolve(redis);
    });

    redis.on('error', (err) => {
      logger.warn('Redis connection error (non-fatal):', err.message);
      resolve(null); // app still works without Redis
    });

    redis.connect().catch(() => resolve(null));
  });
}

function getRedis() {
  return redis;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setEx(key, value, ttlSeconds = 3600) {
  if (!redis) return null;
  try {
    await redis.set(
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
      'EX',
      ttlSeconds
    );
  } catch (e) {
    logger.warn('Redis setEx error:', e.message);
  }
}

async function get(key) {
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    if (!val) return null;
    try { return JSON.parse(val); } catch { return val; }
  } catch (e) {
    logger.warn('Redis get error:', e.message);
    return null;
  }
}

async function del(...keys) {
  if (!redis) return;
  try { await redis.del(...keys); } catch (e) {
    logger.warn('Redis del error:', e.message);
  }
}

module.exports = { connectRedis, getRedis, setEx, get, del };
