const savedListingsService = require('../services/savedListingsService');
const priceAlertService = require('../services/priceAlertService');
const voiceSearchService = require('../services/voiceSearchService');

/**
 * Buyer Controller — F01, F02, F03, F04
 */

// ── Helper ────────────────────────────────────────────────────────────────────
function getIdentity(req) {
  return {
    userId: req.user?.id || null,
    sessionToken: req.headers['x-session-token'] || req.query.session || null,
  };
}

// ── F01: SAVED LISTINGS ───────────────────────────────────────────────────────

/**
 * POST /buyer/saved/:listingId
 * Toggle save. Returns { saved, saveCount }
 */
exports.toggleSave = async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const { userId, sessionToken } = getIdentity(req);
    const { email } = req.body;

    if (!userId && !sessionToken) {
      return res.status(400).json({ success: false, message: 'x-session-token header or auth required' });
    }

    const result = await savedListingsService.toggleSave(listingId, userId, sessionToken, email);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /buyer/saved
 * List saved listings for the current user/session
 */
exports.getSavedListings = async (req, res, next) => {
  try {
    const { userId, sessionToken } = getIdentity(req);
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const result = await savedListingsService.getSavedListings(userId, sessionToken, { page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /buyer/saved/:listingId/status
 * Check if a single listing is saved
 */
exports.getSaveStatus = async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const { userId, sessionToken } = getIdentity(req);

    if (!userId && !sessionToken) {
      return res.json({ success: true, data: { saved: false } });
    }

    const saved = await savedListingsService.isSaved(listingId, userId, sessionToken);
    res.json({ success: true, data: { saved } });
  } catch (err) {
    next(err);
  }
};

// ── F02: COMPARE (server-side: get listing details for compare page) ───────────

/**
 * GET /buyer/compare?ids=uuid1,uuid2,uuid3
 * Returns full listing details for the compare page (max 3)
 */
exports.getCompareListings = async (req, res, next) => {
  try {
    const { pool } = require('../config/database');
    const rawIds = req.query.ids || '';
    const ids = rawIds.split(',').filter(Boolean).slice(0, 3);

    if (ids.length < 2) {
      return res.status(400).json({ success: false, message: 'Provide at least 2 listing IDs' });
    }

    const result = await pool.query(
      `SELECT
          l.id, l.title, l.price, l.property_type, l.listing_type,
          l.bedrooms, l.bathrooms, l.area_sqft, l.floor_number, l.total_floors,
          l.furnishing, l.facing, l.parking_count,
          l.address, l.locality, l.city, l.state, l.pincode,
          l.images, l.amenities, l.status, l.short_code,
          l.view_count, l.price_negotiable,
          u.name AS agent_name, u.phone AS agent_phone, u.rera_number AS agent_rera,
          (SELECT COUNT(*) FROM saved_listings s WHERE s.listing_id = l.id) AS save_count,
          (SELECT COUNT(*) FROM qr_codes q WHERE q.listing_id = l.id) AS qr_count,
          (
            SELECT new_price FROM listing_price_history
            WHERE listing_id = l.id
            ORDER BY changed_at DESC LIMIT 1
          ) AS last_price
       FROM listings l
       JOIN users u ON u.id = l.agent_id
       WHERE l.id = ANY($1::uuid[])`,
      [ids]
    );

    res.json({ success: true, data: { listings: result.rows } });
  } catch (err) {
    next(err);
  }
};

// ── F03: PRICE ALERTS ─────────────────────────────────────────────────────────

/**
 * POST /buyer/alerts
 * Subscribe to price drop alert for a listing
 */
exports.subscribeAlert = async (req, res, next) => {
  try {
    const { listingId, email } = req.body;
    if (!listingId || !email) {
      return res.status(400).json({ success: false, message: 'listingId and email are required' });
    }

    const result = await priceAlertService.subscribe(listingId, email);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Listing not found or not active') {
      return res.status(404).json({ success: false, message: err.message });
    }
    next(err);
  }
};

/**
 * GET /buyer/alerts/unsubscribe/:token
 * Unsubscribe via email link
 */
exports.unsubscribeAlert = async (req, res, next) => {
  try {
    const { token } = req.params;
    await priceAlertService.unsubscribe(token);
    // Redirect to frontend with success message
    res.redirect(`${process.env.FRONTEND_URL}/alerts/unsubscribed`);
  } catch (err) {
    if (err.message === 'Invalid unsubscribe token') {
      return res.status(404).json({ success: false, message: err.message });
    }
    next(err);
  }
};

/**
 * POST /buyer/alerts/trigger (internal/cron endpoint — secured by CRON_SECRET)
 */
exports.triggerAlertCron = async (req, res, next) => {
  try {
    const secret = req.headers['x-cron-secret'];
    if (secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const result = await priceAlertService.checkAndSendAlerts();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

// ── F04: VOICE SEARCH ─────────────────────────────────────────────────────────

/**
 * POST /buyer/search/voice
 * Body: { transcript: string }
 */
exports.voiceSearch = async (req, res, next) => {
  try {
    const { transcript } = req.body;
    if (!transcript || transcript.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'transcript is required' });
    }
    if (transcript.length > 500) {
      return res.status(400).json({ success: false, message: 'transcript too long (max 500 chars)' });
    }

    const { userId, sessionToken } = getIdentity(req);
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const result = await voiceSearchService.voiceSearch(transcript, userId, sessionToken, { page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};
