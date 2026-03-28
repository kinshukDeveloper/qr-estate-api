const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');
const analyticsService = require('../services/analyticsService');

router.use(authenticate);

// GET /api/v1/analytics — full bundle
router.get('/', asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const data = await analyticsService.getFullAnalytics(req.user.id, days);
  res.json({ success: true, data });
}));

// GET /api/v1/analytics/overview
router.get('/overview', asyncHandler(async (req, res) => {
  const data = await analyticsService.getOverviewStats(req.user.id);
  res.json({ success: true, data });
}));

// GET /api/v1/analytics/daily?days=30
router.get('/daily', asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const data = await analyticsService.getDailyScans(req.user.id, days);
  res.json({ success: true, data });
}));

// GET /api/v1/analytics/devices
router.get('/devices', asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const data = await analyticsService.getScansByDevice(req.user.id, days);
  res.json({ success: true, data });
}));

// GET /api/v1/analytics/top-listings
router.get('/top-listings', asyncHandler(async (req, res) => {
  const data = await analyticsService.getTopListings(req.user.id);
  res.json({ success: true, data });
}));

module.exports = router;
