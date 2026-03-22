'use strict';

const express  = require('express');
const router   = express.Router();
const rateLimit = require('express-rate-limit');
const cb       = require('../services/callbackService');
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler, createError } = require('../middleware/errorHandler');

// ── Public rate limit — 3 requests per IP per 10 min ──────────────────────────
const publicLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { success: false, message: 'Too many callback requests. Wait 10 minutes.' },
});

// ── PUBLIC: buyer requests a callback ─────────────────────────────────────────
// POST /api/v1/callbacks/request/:listingId
router.post('/request/:listingId', publicLimit, asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone) throw createError('Phone number is required', 400);

  const result = await cb.requestCallback(req.params.listingId, phone);
  res.status(201).json({ success: true, data: result });
}));

// ── PUBLIC: Twilio TwiML bridge (called by Twilio when agent picks up) ────────
// GET /api/v1/callbacks/twiml/:requestId?buyer=+91xxxxxxxxxx
router.get('/twiml/:requestId', (req, res) => {
  const buyerPhone = req.query.buyer;
  const xml = cb.buildTwiml(buyerPhone || '');
  res.type('text/xml').send(xml);
});

// ── PUBLIC: Twilio status callback webhook ────────────────────────────────────
// POST /api/v1/callbacks/status/:requestId
router.post('/status/:requestId', asyncHandler(async (req, res) => {
  const callStatus = req.body.CallStatus || req.body.callStatus || '';
  await cb.handleStatusCallback(req.params.requestId, callStatus);
  res.sendStatus(204);
}));

// ── All routes below require auth ─────────────────────────────────────────────
router.use(authenticate);

// GET /api/v1/callbacks/stats — dashboard widget
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await cb.getCallbackStats(req.user.id);
  res.json({ success: true, data: stats });
}));

// GET /api/v1/callbacks?status=missed&page=1 — callback list
router.get('/', asyncHandler(async (req, res) => {
  const result = await cb.getCallbacks(req.user.id, {
    page:   parseInt(req.query.page)  || 1,
    limit:  parseInt(req.query.limit) || 20,
    status: req.query.status,
  });
  res.json({ success: true, data: result });
}));

module.exports = router;
