'use strict';
const express  = require('express');
const router   = express.Router();
const opt      = require('../services/optimizerService');
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(authenticate);

// POST /api/v1/optimizer/price/:listingId
router.post('/price/:listingId',     asyncHandler(async (req, res) => {
  const data = await opt.suggestPrice(req.params.listingId, req.user.id);
  res.json({ success: true, data });
}));

// POST /api/v1/optimizer/title/:listingId
router.post('/title/:listingId',     asyncHandler(async (req, res) => {
  const data = await opt.optimizeTitle(req.params.listingId, req.user.id);
  res.json({ success: true, data });
}));

// POST /api/v1/optimizer/amenities/:listingId
router.post('/amenities/:listingId', asyncHandler(async (req, res) => {
  const data = await opt.analyzeAmenityGap(req.params.listingId, req.user.id);
  res.json({ success: true, data });
}));

// POST /api/v1/optimizer/conversion/:listingId
router.post('/conversion/:listingId', asyncHandler(async (req, res) => {
  const data = await opt.predictConversion(req.params.listingId, req.user.id);
  res.json({ success: true, data });
}));

module.exports = router;
