const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const buyerController = require('../controllers/buyerController');
const { authenticate, optionalAuthenticate } = require('../middleware/authenticate');

// Rate limiter for voice search (OpenAI calls are expensive)
const voiceLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 10,                     // 10 voice searches per minute per IP
  message: { success: false, message: 'Too many voice searches. Please wait.' },
});

// Rate limiter for price alert subscriptions
const alertLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,   // 10 minutes
  max: 5,                      // 5 subscriptions per 10 min per IP
  message: { success: false, message: 'Too many alert subscriptions. Please wait.' },
});


// ── F01: Saved Listings ────────────────────────────────────────────────────────
// optionalAuthenticate: works for both guests and logged-in users
router.post('/saved/:listingId', optionalAuthenticate, buyerController.toggleSave);
router.get('/saved', optionalAuthenticate, buyerController.getSavedListings);
router.get('/saved/:listingId/status', optionalAuthenticate, buyerController.getSaveStatus);

// ── F02: Compare ───────────────────────────────────────────────────────────────
// No auth needed — shareable URL
router.get('/compare', buyerController.getCompareListings);

// ── F03: Price Alerts ─────────────────────────────────────────────────────────
router.post('/alerts', alertLimiter, buyerController.subscribeAlert);
router.get('/alerts/unsubscribe/:token', buyerController.unsubscribeAlert);
router.post('/alerts/trigger', buyerController.triggerAlertCron);  // cron endpoint

// ── F04: Voice Search ──────────────────────────────────────────────────────────
router.post('/search/voice', voiceLimiter, optionalAuthenticate, buyerController.voiceSearch);

module.exports = router;
