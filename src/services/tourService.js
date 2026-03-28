'use strict';
/**
 * tourService.js — Feature 5: Virtual Tour Embed
 * Validates, stores tour URLs + tracks tour_view events.
 */

const { query }      = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// ── Allowed domains (XSS whitelist) ──────────────────────────────────────────
const ALLOWED_DOMAINS = [
  'matterport.com',
  'my.matterport.com',
  'kuula.co',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'vimeo.com',
  'player.vimeo.com',
];

function validateTourUrl(rawUrl) {
  if (!rawUrl) return null;

  let parsed;
  try { parsed = new URL(rawUrl); } catch {
    throw createError('Tour URL is not a valid URL', 400);
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = ALLOWED_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
  if (!allowed) {
    throw createError(
      `Tour URL domain not allowed. Supported: Matterport, YouTube, Vimeo, Kuula.`,
      400
    );
  }

  // Force HTTPS
  if (parsed.protocol !== 'https:') {
    throw createError('Tour URL must use HTTPS', 400);
  }

  return rawUrl.trim();
}

// ── Convert watch URL → embed URL ─────────────────────────────────────────────
function toEmbedUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();

    // YouTube: youtube.com/watch?v=ID → youtube-nocookie.com/embed/ID
    if (host.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube-nocookie.com/embed/${v}?rel=0&modestbranding=1`;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.replace('/', '');
      return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
    }

    // Matterport: share URL → embed URL
    if (host.includes('matterport.com')) {
      const m = rawUrl.match(/\/show\/\?m=([^&]+)/);
      if (m) return `https://my.matterport.com/show/?m=${m[1]}&play=1`;
    }

    // Vimeo: vimeo.com/ID → player.vimeo.com/video/ID
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}?dnt=1`;
    }

    // Kuula + others: pass through as-is
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

// ── Set tour URL on a listing ─────────────────────────────────────────────────
async function setTourUrl(listingId, agentId, rawUrl) {
  const validated = rawUrl ? validateTourUrl(rawUrl) : null;

  const result = await query(
    `UPDATE listings SET tour_url = $1, updated_at = NOW()
     WHERE id = $2 AND agent_id = $3
     RETURNING id, tour_url`,
    [validated, listingId, agentId]
  );

  if (!result.rows[0]) throw createError('Listing not found or access denied', 404);
  return { tour_url: validated, embed_url: toEmbedUrl(validated) };
}

// ── Track a tour view ─────────────────────────────────────────────────────────
async function trackTourView(shortCode, ip, userAgent) {
  try {
    // Get listing + its QR code
    const res = await query(
      `SELECT l.id AS listing_id, q.id AS qr_code_id
       FROM listings l
       LEFT JOIN qr_codes q ON q.listing_id = l.id AND q.is_active = true
       WHERE l.short_code = $1`,
      [shortCode]
    );
    const row = res.rows[0];
    if (!row) return;

    // Record in qr_scans with event_type = 'tour_view'
    await query(
      `INSERT INTO qr_scans
         (qr_code_id, listing_id, ip_address, user_agent, event_type)
       VALUES ($1, $2, $3, $4, 'tour_view')
       ON CONFLICT DO NOTHING`,
      [row.qr_code_id, row.listing_id, ip?.substring(0, 45), userAgent?.substring(0, 255)]
    );
  } catch (err) {
    // fire-and-forget — never throw
  }
}

// ── Get tour analytics for agent ─────────────────────────────────────────────
async function getTourAnalytics(agentId) {
  const result = await query(
    `SELECT
       COUNT(l.id)  FILTER (WHERE l.tour_url IS NOT NULL)::int AS listings_with_tour,
       COUNT(l.id)  FILTER (WHERE l.tour_url IS NULL)::int     AS listings_without_tour,
       COALESCE(SUM(CASE WHEN qs.event_type = 'tour_view' THEN 1 ELSE 0 END), 0)::int AS total_tour_views,
       COALESCE(SUM(CASE WHEN qs.event_type = 'scan'      THEN 1 ELSE 0 END), 0)::int AS total_scans
     FROM listings l
     LEFT JOIN qr_scans qs ON qs.listing_id = l.id
     WHERE l.agent_id = $1`,
    [agentId]
  );
  return result.rows[0];
}

module.exports = { validateTourUrl, toEmbedUrl, setTourUrl, trackTourView, getTourAnalytics };
