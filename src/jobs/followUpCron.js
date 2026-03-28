require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { processDueFollowUps } = require('../services/followUpService');
const logger = require('../config/logger');

async function run() {
  logger.info('[FollowUpCron] Starting...');
  try {
    const result = await processDueFollowUps();
    logger.info(`[FollowUpCron] Done. Sent:${result.sent} Failed:${result.failed}`);
    process.exit(0);
  } catch (err) {
    logger.error(`[FollowUpCron] Fatal: ${err.message}`);
    process.exit(1);
  }
}
run();
