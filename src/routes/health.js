const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');
const healthService = require('../services/healthService');

router.use(authenticate);

// GET /api/v1/health/qr — full health report
router.get('/qr', asyncHandler(async (req, res) => {
  const report = await healthService.getHealthReport(req.user.id);
  res.json({ success: true, data: report });
}));

module.exports = router;
