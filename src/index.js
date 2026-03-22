/**
 * Local development server entry point.
 *
 * This file is NOT used by Vercel. Vercel uses api/index.js which exports
 * the Express app from src/app.js.
 *
 * Run locally:
 *   npm run dev   → nodemon src/index.js
 *   npm start     → node src/index.js
 */
require('dotenv').config();

const logger = require('./config/logger');
const { connectDB, pool } = require('./config/database');
const { connectRedis } = require('./config/redis');
const app = require('./app');

// ── CRON JOBS (local + Railway only) ──────────────────────────────────────────
// On Vercel, use Vercel Cron Jobs instead (vercel.json → "crons" key).
let cronScheduled = false;

async function startServer() {
  try {
    await connectDB();
    await connectRedis();

    const PORT = parseInt(process.env.PORT) || 5000;

    const server = app.listen(PORT, () => {
      logger.info('🚀 QR Estate API (local dev)');
      logger.info(`   Port    : ${PORT}`);
      logger.info(`   Env     : ${process.env.NODE_ENV}`);
      logger.info(`   API     : http://localhost:${PORT}/api/${process.env.API_VERSION || 'v1'}`);
      logger.info(`   Health  : http://localhost:${PORT}/health`);
    });

    if (!cronScheduled && process.env.NODE_ENV !== 'test') {
      const cron = require('node-cron');
      const { runGlobalHealthCheck } = require('./services/healthService');
      cron.schedule('0 9 * * *', () => {
        runGlobalHealthCheck().catch(err => logger.error('Cron error:', err));
      });
      cronScheduled = true;
      logger.info('   Cron    : Health check @ 9am IST daily');
    }

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down...`);
      server.close(async () => {
        try { await pool.end(); } catch {}
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', err);
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection:', reason);
    });

  } catch (err) {
    logger.error('Failed to start:', err);
    process.exit(1);
  }
}

startServer();
