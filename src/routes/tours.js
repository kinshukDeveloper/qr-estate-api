'use strict';
const express = require('express');
const router  = express.Router();
const tour    = require('../services/tourService');
const { authenticate }               = require('../middleware/authenticate');
const { asyncHandler, createError }  = require('../middleware/errorHandler');

// ── Public: track a tour view ─────────────────────────────────────────────────
// POST /api/v1/tours/view/:shortCode  (no auth, called client-side on embed load)
router.post('/view/:shortCode', asyncHandler(async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'];
  await tour.trackTourView(req.params.shortCode, ip, req.headers['user-agent']);
  res.sendStatus(204);
}));

router.use(authenticate);

// PATCH /api/v1/tours/:listingId  — set or remove tour URL
router.patch('/:listingId', asyncHandler(async (req, res) => {
  const { tour_url } = req.body; // null = remove
  const result = await tour.setTourUrl(req.params.listingId, req.user.id, tour_url || null);
  res.json({ success: true, data: result });
}));

// GET /api/v1/tours/analytics  — tour view counts
router.get('/analytics', asyncHandler(async (req, res) => {
  const data = await tour.getTourAnalytics(req.user.id);
  res.json({ success: true, data });
}));

module.exports = router;
