require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { scoreAllLeads } = require('../services/leadScoringService');
const logger = require('../config/logger');

async function run() {
  logger.info('[LeadScoreCron] Starting...');
  try {
    const result = await scoreAllLeads();
    logger.info(`[LeadScoreCron] Done. Scored:${result.scored} Failed:${result.failed}`);
    process.exit(0);
  } catch (err) {
    logger.error(`[LeadScoreCron] Fatal: ${err.message}`);
    process.exit(1);
  }
}
run();
