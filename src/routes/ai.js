const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/aiController');
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');

// All AI routes require auth
router.use(authenticate);

// Rate limit AI endpoints — they're expensive (OpenAI API calls)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'production' ? 15 : 100,
  message: { success: false, message: 'AI rate limit reached. Wait 1 minute.' },
  keyGenerator: (req) => req.user?.id || req.ip, // per-user, not per-IP
});

router.use(aiLimiter);

// GET  /api/v1/ai/score/:listingId      — get quality score (fast, no OpenAI)
router.get('/score/:listingId', asyncHandler(c.getScore));

// POST /api/v1/ai/tips/:listingId       — get AI coaching tips (OpenAI/fallback)
router.post('/tips/:listingId', asyncHandler(c.getTips));

// POST /api/v1/ai/write-description/:listingId  — generate 3 description variants
router.post('/write-description/:listingId', asyncHandler(c.writeDescription));

// POST /api/v1/ai/photo-check/:listingId — analyse photo quality with GPT-4o Vision
router.post('/photo-check/:listingId', asyncHandler(c.checkPhotos));

// DELETE /api/v1/ai/cache/:listingId    — force-clear cache (manual refresh)
router.delete('/cache/:listingId', asyncHandler(c.clearCache));

module.exports = router;
