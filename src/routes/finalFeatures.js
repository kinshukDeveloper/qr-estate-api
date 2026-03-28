// routes/finalFeatures.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/finalFeaturesController');
const { authenticate, optionalAuthenticate } = require('../middleware/authenticate');
const rateLimit = require('express-rate-limit');

const chatLimiter = rateLimit({ windowMs: 60000, max: 30, message: { success: false, message: 'Too many chat messages' } });
const reviewLimiter = rateLimit({ windowMs: 3600000, max: 5, message: { success: false, message: 'Too many review submissions' } });

// ── F13: Lead Scoring ─────────────────────────────────────────────────────────
router.get  ('/leads/scores',              authenticate, ctrl.getLeadScores);
router.get  ('/leads/scores/summary',      authenticate, ctrl.getScoreSummary);
router.post ('/leads/:leadId/score',       authenticate, ctrl.scoreOneLead);
router.post ('/leads/score-all',           ctrl.scoreAllLeads);           // cron

// ── F14: Photo Advisor ────────────────────────────────────────────────────────
router.post ('/listings/:listingId/photos/analyse', authenticate, ctrl.analysePhotos);

// ── F15: AI Chat ──────────────────────────────────────────────────────────────
router.post ('/listings/:listingId/chat',          chatLimiter, ctrl.chat);         // public
router.get  ('/listings/:listingId/chat/history',  ctrl.getChatHistory);            // public
router.post ('/chat/capture-lead',                 ctrl.captureChatLead);           // public

// ── F16: NRI ──────────────────────────────────────────────────────────────────
router.get  ('/nri/countries',             ctrl.getNRICountries);
router.get  ('/nri/convert',               ctrl.convertPrice);
router.post ('/nri/callback',              ctrl.submitNRICallback);

// ── F17: EMI Calculator ───────────────────────────────────────────────────────
router.get  ('/emi/calculate',             ctrl.calculateEMI);
router.get  ('/emi/banks',                 ctrl.getBankRates);

// ── F18: Featured + Reviews ───────────────────────────────────────────────────
router.get  ('/featured',                  ctrl.getFeatured);
router.get  ('/featured/tiers',            ctrl.getBoostTiers);
router.post ('/listings/:listingId/boost', authenticate, ctrl.boostListing);
router.post ('/reviews',                   reviewLimiter, ctrl.submitReview);
router.get  ('/agents/:agentId/reviews',   ctrl.getAgentReviews);
router.patch('/reviews/:reviewId/reply',   authenticate, ctrl.replyToReview);

module.exports = router;
