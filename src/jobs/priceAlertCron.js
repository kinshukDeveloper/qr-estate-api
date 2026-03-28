/**
 * F03 — Price Alert Cron Job
 * Runs every 6 hours. Checks for price drops and sends emails.
 *
 * Usage: node src/jobs/priceAlertCron.js
 * Or schedule via cron:  0 */6 * * * node /app/src/jobs/priceAlertCron.js
 *
 * On Vercel/Railway: use a cron endpoint instead (see below).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { checkAndSendAlerts } = require('../services/priceAlertService');
const logger = require('../config/logger');

async function run() {
  logger.info('[PriceAlertCron] Starting...');
  try {
    const result = await checkAndSendAlerts();
    logger.info(`[PriceAlertCron] Done. Alerts sent: ${result.sent}`);
    process.exit(0);
  } catch (err) {
    logger.error(`[PriceAlertCron] Fatal error: ${err.message}`);
    process.exit(1);
  }
}

run();
