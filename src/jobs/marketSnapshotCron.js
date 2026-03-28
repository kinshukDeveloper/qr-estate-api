require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { takeSnapshot } = require('../services/marketService');
const logger = require('../config/logger');

async function run() {
  logger.info('[MarketCron] Taking daily market snapshot...');
  try {
    const result = await takeSnapshot();
    logger.info(`[MarketCron] Done. Rows upserted: ${result.rowsUpserted}`);
    process.exit(0);
  } catch (err) {
    logger.error(`[MarketCron] Fatal: ${err.message}`);
    process.exit(1);
  }
}
run();
