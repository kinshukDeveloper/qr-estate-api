'use strict';
const express  = require('express');
const router   = express.Router();
const builder  = require('../services/builderService');
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler, createError } = require('../middleware/errorHandler');

router.use(authenticate);

// ── Templates ──────────────────────────────────────────────────
// GET    /api/v1/builder/templates
router.get('/templates', asyncHandler(async (req, res) => {
  const templates = await builder.listTemplates(req.user.id);
  res.json({ success: true, data: { templates } });
}));

// POST   /api/v1/builder/templates  — save from a listing
router.post('/templates', asyncHandler(async (req, res) => {
  const tmpl = await builder.saveTemplate(req.user.id, req.body);
  res.status(201).json({ success: true, data: { template: tmpl } });
}));

// DELETE /api/v1/builder/templates/:id
router.delete('/templates/:id', asyncHandler(async (req, res) => {
  const result = await builder.deleteTemplate(req.user.id, req.params.id);
  res.json({ success: true, data: result });
}));

// POST   /api/v1/builder/templates/:id/clone
// Body: { price, address, title? ...overrides }
router.post('/templates/:id/clone', asyncHandler(async (req, res) => {
  const listing = await builder.cloneFromTemplate(req.user.id, req.params.id, req.body);
  res.status(201).json({ success: true, data: { listing } });
}));

// ── CSV Import ─────────────────────────────────────────────────
// GET  /api/v1/builder/import/template — download CSV template
router.get('/import/template', (req, res) => {
  const csv = builder.getCsvTemplate();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="qrestate-import-template.csv"');
  res.send(csv);
});

// POST /api/v1/builder/import
// Body: { csv: "<csv text>" } OR raw text/csv body
router.post('/import', asyncHandler(async (req, res) => {
  let csvText;
  if (req.headers['content-type']?.includes('text/csv')) {
    csvText = req.body?.toString?.() || '';
  } else {
    csvText = req.body?.csv || '';
  }
  if (!csvText?.trim()) throw createError('CSV data is required. Send as { csv: "..." } or raw text/csv body', 400);

  const result = await builder.processCsvImport(req.user.id, csvText);
  const status = result.failed > 0 && result.success === 0 ? 422 : 201;
  res.status(status).json({ success: true, data: result });
}));

// ── Bulk QR Generation ─────────────────────────────────────────
// POST /api/v1/builder/qr/bulk-generate
router.post('/qr/bulk-generate', asyncHandler(async (req, res) => {
  const result = await builder.bulkGenerateQR(req.user.id);
  res.json({ success: true, data: result });
}));

// ── Bulk Export ────────────────────────────────────────────────
// GET /api/v1/builder/export?status=active&city=Chandigarh
router.get('/export', asyncHandler(async (req, res) => {
  const csv = await builder.exportListingsCsv(req.user.id, {
    status:        req.query.status,
    property_type: req.query.property_type,
    city:          req.query.city,
  });
  const timestamp = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="listings-export-${timestamp}.csv"`);
  res.send(csv);
}));

module.exports = router;
