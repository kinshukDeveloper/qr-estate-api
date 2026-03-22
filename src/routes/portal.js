'use strict';
const express  = require('express');
const router   = express.Router();
const portal   = require('../services/portalService');
const { authenticate }               = require('../middleware/authenticate');
const { asyncHandler, createError }  = require('../middleware/errorHandler');

// ═══════════════════════════════════════════════════════════════
//  PUBLIC PORTAL API — accessed via API keys (no JWT needed)
//  Base: /api/v1/portal
// ═══════════════════════════════════════════════════════════════

// Middleware to validate API key from Authorization header
async function requireApiKey(req, res, next) {
  const auth = req.headers.authorization || '';
  const raw  = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!raw) return res.status(401).json({ success: false, message: 'API key required in Authorization: Bearer <key>' });

  const key = await portal.validateApiKey(raw);
  if (!key) return res.status(401).json({ success: false, message: 'Invalid or expired API key' });

  req.apiKey = key;
  next();
}

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey.scopes?.includes(scope)) {
      return res.status(403).json({ success: false, message: `API key lacks scope: ${scope}` });
    }
    next();
  };
}

// GET /api/v1/portal/listings — public portal listing feed
router.get('/listings', requireApiKey, requireScope('listings:read'), asyncHandler(async (req, res) => {
  const data = await portal.getPortalListings({
    agencyId:      req.query.agency_id,
    city:          req.query.city,
    property_type: req.query.property_type,
    listing_type:  req.query.listing_type,
    min_price:     req.query.min_price,
    max_price:     req.query.max_price,
    bedrooms:      req.query.bedrooms,
    page:          req.query.page,
    limit:         req.query.limit,
  });
  res.json({ success: true, ...data });
}));

// GET /api/v1/portal/listings/:shortCode — single listing
router.get('/listings/:shortCode', requireApiKey, requireScope('listings:read'), asyncHandler(async (req, res) => {
  const { query } = require('../config/database');
  const res2 = await query(
    `SELECT l.*, u.name AS agent_name, u.rera_number AS agent_rera
     FROM listings l JOIN users u ON u.id=l.agent_id
     WHERE l.short_code=$1 AND l.status='active'`,
    [req.params.shortCode]
  );
  if (!res2.rows[0]) throw createError('Listing not found', 404);
  const l = res2.rows[0];
  res.json({ success: true, data: { listing: { ...l, portal_url: `${process.env.FRONTEND_URL}/p/${l.short_code}` } } });
}));

// ═══════════════════════════════════════════════════════════════
//  AGENT-AUTH MANAGEMENT ROUTES (JWT needed)
// ═══════════════════════════════════════════════════════════════
router.use(authenticate);

// ── API Keys ──────────────────────────────────────────────────
router.post('/keys',              asyncHandler(async (req, res) => {
  const key = await portal.createApiKey(req.user.id, req.body);
  res.status(201).json({ success: true, data: { key } });
}));

router.get('/keys',               asyncHandler(async (req, res) => {
  const keys = await portal.listApiKeys(req.user.id);
  res.json({ success: true, data: { keys } });
}));

router.delete('/keys/:keyId',     asyncHandler(async (req, res) => {
  const result = await portal.revokeApiKey(req.user.id, req.params.keyId);
  res.json({ success: true, data: result });
}));

// ── Webhooks ──────────────────────────────────────────────────
router.post('/webhooks',          asyncHandler(async (req, res) => {
  const wh = await portal.createWebhook(req.user.id, req.body);
  res.status(201).json({ success: true, data: { webhook: wh } });
}));

router.get('/webhooks',           asyncHandler(async (req, res) => {
  const whs = await portal.listWebhooks(req.user.id);
  res.json({ success: true, data: { webhooks: whs } });
}));

router.delete('/webhooks/:id',    asyncHandler(async (req, res) => {
  const result = await portal.deleteWebhook(req.user.id, req.params.id);
  res.json({ success: true, data: result });
}));

router.get('/webhooks/:id/deliveries', asyncHandler(async (req, res) => {
  const deliveries = await portal.getWebhookDeliveries(req.user.id, req.params.id);
  res.json({ success: true, data: { deliveries } });
}));

// GET /api/v1/portal/events — list valid event types
router.get('/events', (req, res) => {
  res.json({ success: true, data: { events: portal.VALID_EVENTS, scopes: portal.VALID_SCOPES } });
});

module.exports = router;
