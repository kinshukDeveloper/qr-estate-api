// routes/intelligence.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/intelligenceController');
const { authenticate, optionalAuthenticate } = require('../middleware/authenticate');

// ── F09: Document Vault ───────────────────────────────────────────────────────
router.post  ('/listings/:listingId/documents',          authenticate, ctrl.uploadDocument);
router.get   ('/listings/:listingId/documents',          optionalAuthenticate, ctrl.getDocuments);
router.delete('/documents/:docId',                       authenticate, ctrl.deleteDocument);
router.post  ('/documents/:docId/request',               ctrl.requestAccess);        // public — buyers
router.get   ('/listings/:listingId/documents/requests', authenticate, ctrl.getRequests);
router.post  ('/documents/requests/:requestId/approve',  authenticate, ctrl.approveRequest);
router.post  ('/documents/requests/:requestId/reject',   authenticate, ctrl.rejectRequest);
router.get   ('/documents/download/:token',              ctrl.secureDownload);       // tokenised

// ── F10: Market Intelligence ──────────────────────────────────────────────────
router.post  ('/market/snapshot',        ctrl.marketSnapshot);     // cron
router.get   ('/market/cities',          ctrl.getCities);
router.get   ('/market/trend',           ctrl.getPriceTrend);
router.get   ('/market/heatmap',         ctrl.getHeatmap);
router.get   ('/market/city/:city',      ctrl.getCitySummary);
router.get   ('/market/supply-demand',   ctrl.getSupplyDemand);

// ── F11: Neighbourhood ────────────────────────────────────────────────────────
router.get   ('/listings/:listingId/neighbourhood', ctrl.getNeighbourhood);

// ── F12: AVM ──────────────────────────────────────────────────────────────────
router.post  ('/avm/value',                          optionalAuthenticate, ctrl.runValuation);
router.get   ('/listings/:listingId/avm',            optionalAuthenticate, ctrl.getLatestValuation);
router.get   ('/avm/history',                        authenticate, ctrl.getAgentValuations);

module.exports = router;
