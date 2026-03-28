const { pool } = require('../config/database');

/**
 * F01 — Saved Listings Service
 * Handles save/unsave/list for both guests (session_token) and logged-in users.
 */

/**
 * Build the identity clause for queries.
 * Priority: user_id > session_token
 */
function identityClause(userId, sessionToken) {
  if (userId) return { field: 'user_id', value: userId };
  if (sessionToken) return { field: 'session_token', value: sessionToken };
  throw new Error('Must provide userId or sessionToken');
}

/**
 * Toggle save on a listing. Returns { saved: bool, saveCount: number }
 */
async function toggleSave(listingId, userId, sessionToken, buyerEmail = null) {
  const { field, value } = identityClause(userId, sessionToken);

  // Check if already saved
  const existing = await pool.query(
    `SELECT id FROM saved_listings WHERE listing_id = $1 AND ${field} = $2`,
    [listingId, value]
  );

  if (existing.rows.length > 0) {
    // Unsave
    await pool.query(
      `DELETE FROM saved_listings WHERE listing_id = $1 AND ${field} = $2`,
      [listingId, value]
    );
  } else {
    // Save — upsert to handle race conditions
    await pool.query(
      `INSERT INTO saved_listings (listing_id, ${field}, buyer_email)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [listingId, value, buyerEmail]
    );
  }

  // Return fresh save count for this listing
  const countRes = await pool.query(
    `SELECT COUNT(*) AS count FROM saved_listings WHERE listing_id = $1`,
    [listingId]
  );

  return {
    saved: existing.rows.length === 0, // true if we just saved, false if we unsaved
    saveCount: parseInt(countRes.rows[0].count, 10),
  };
}

/**
 * Check if a listing is saved by this identity
 */
async function isSaved(listingId, userId, sessionToken) {
  const { field, value } = identityClause(userId, sessionToken);
  const res = await pool.query(
    `SELECT id FROM saved_listings WHERE listing_id = $1 AND ${field} = $2`,
    [listingId, value]
  );
  return res.rows.length > 0;
}

/**
 * Get all saved listings for a user/session (with listing details)
 */
async function getSavedListings(userId, sessionToken, { page = 1, limit = 20 } = {}) {
  const { field, value } = identityClause(userId, sessionToken);
  const offset = (page - 1) * limit;

  const res = await pool.query(
    `SELECT
        l.id, l.title, l.price, l.property_type, l.listing_type,
        l.bedrooms, l.bathrooms, l.area_sqft,
        l.address, l.locality, l.city, l.state,
        l.images, l.status, l.short_code,
        l.view_count, l.created_at,
        sl.created_at AS saved_at,
        u.name AS agent_name,
        u.phone AS agent_phone,
        (SELECT COUNT(*) FROM saved_listings s2 WHERE s2.listing_id = l.id) AS save_count
       FROM saved_listings sl
       JOIN listings l ON l.id = sl.listing_id
       JOIN users u ON u.id = l.agent_id
       WHERE sl.${field} = $1
         AND l.status IN ('active', 'draft')
       ORDER BY sl.created_at DESC
       LIMIT $2 OFFSET $3`,
    [value, limit, offset]
  );

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM saved_listings WHERE ${field} = $1`,
    [value]
  );

  return {
    listings: res.rows,
    pagination: {
      total: parseInt(countRes.rows[0].count, 10),
      page,
      limit,
      pages: Math.ceil(countRes.rows[0].count / limit),
    },
  };
}

/**
 * Get save count for multiple listings at once (for agent dashboard)
 */
async function getSaveCounts(listingIds) {
  if (!listingIds.length) return {};
  const res = await pool.query(
    `SELECT listing_id, COUNT(*) AS count
     FROM saved_listings
     WHERE listing_id = ANY($1::uuid[])
     GROUP BY listing_id`,
    [listingIds]
  );
  return Object.fromEntries(res.rows.map((r) => [r.listing_id, parseInt(r.count, 10)]));
}

/**
 * Check saved status for multiple listings at once (public property pages)
 */
async function getBulkSavedStatus(listingIds, userId, sessionToken) {
  if (!listingIds.length) return {};
  const { field, value } = identityClause(userId, sessionToken);
  const res = await pool.query(
    `SELECT listing_id FROM saved_listings
     WHERE listing_id = ANY($1::uuid[]) AND ${field} = $2`,
    [listingIds, value]
  );
  return Object.fromEntries(res.rows.map((r) => [r.listing_id, true]));
}

module.exports = {
  toggleSave,
  isSaved,
  getSavedListings,
  getSaveCounts,
  getBulkSavedStatus,
};
