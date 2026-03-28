const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/featuresController');
const { authenticate, optionalAuthenticate } = require('../middleware/authenticate');

// ── F05: Videos ───────────────────────────────────────────────────────────────
router.post  ('/listings/:listingId/videos',       authenticate, ctrl.uploadVideo);
router.get   ('/listings/:listingId/videos',        ctrl.getVideos);
router.delete('/videos/:videoId',                  authenticate, ctrl.deleteVideo);
router.patch ('/videos/:videoId/label',            authenticate, ctrl.updateVideoLabel);

// ── F06: EOI / E-Signature ───────────────────────────────────────────────────
router.post  ('/eoi',                              ctrl.submitEOI);           // public
router.get   ('/listings/:listingId/eoi',          authenticate, ctrl.getEOIs);
router.patch ('/eoi/:eoiId/status',                authenticate, ctrl.updateEOIStatus);

// ── F07: Commission Calculator ────────────────────────────────────────────────
router.get   ('/commission/calculate',             ctrl.calculateCommission); // public
router.get   ('/commission/states',                ctrl.getStates);           // public

// ── F08: Follow-up Sequences ──────────────────────────────────────────────────
router.get   ('/leads/:leadId/followups',          authenticate, ctrl.getSequence);
router.patch ('/leads/:leadId/followups/toggle',   authenticate, ctrl.toggleSequence);
router.post  ('/followups/trigger',                ctrl.triggerFollowUpCron); // cron

module.exports = router;
