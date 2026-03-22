'use strict';
const express = require('express');
const router  = express.Router();
const wl      = require('../services/whiteLabelService');
const { authenticate }               = require('../middleware/authenticate');
const { asyncHandler }               = require('../middleware/errorHandler');

router.use(authenticate);

// GET  /api/v1/brand           — get current brand config
router.get('/', asyncHandler(async (req, res) => {
  const data = await wl.getConfig(req.user.id);
  res.json({ success: true, data });
}));

// PUT  /api/v1/brand           — create or update brand config
router.put('/', asyncHandler(async (req, res) => {
  const config = await wl.upsertConfig(req.user.id, req.body);
  res.json({ success: true, data: { config } });
}));

// POST /api/v1/brand/domain    — initiate custom domain setup
router.post('/domain', asyncHandler(async (req, res) => {
  const { domain } = req.body;
  const result = await wl.initDomainSetup(req.user.id, domain);
  res.json({ success: true, data: result });
}));

// POST /api/v1/brand/domain/verify  — check DNS + mark verified
router.post('/domain/verify', asyncHandler(async (req, res) => {
  const result = await wl.verifyDomain(req.user.id);
  res.json({ success: true, data: result });
}));

// GET /api/v1/brand/resolve?domain=  — lookup config by custom domain (internal)
router.get('/resolve', asyncHandler(async (req, res) => {
  const { domain } = req.query;
  const config = domain ? await wl.getConfigByDomain(domain) : null;
  res.json({ success: true, data: { config } });
}));

module.exports = router;
