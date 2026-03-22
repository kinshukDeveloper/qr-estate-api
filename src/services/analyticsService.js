const { query } = require('../config/database');

// ── OVERVIEW STATS ────────────────────────────────────────────────────────────
async function getOverviewStats(agentId) {
  const [listingStats, qrStats, scanStats] = await Promise.all([
    query(
      `SELECT
         COUNT(*) as total_listings,
         COUNT(*) FILTER (WHERE status = 'active') as active_listings,
         COUNT(*) FILTER (WHERE status = 'draft') as draft_listings,
         COUNT(*) FILTER (WHERE status = 'sold') as sold_listings,
         COUNT(*) FILTER (WHERE status = 'rented') as rented_listings,
         COALESCE(SUM(view_count), 0) as total_views
       FROM listings WHERE agent_id = $1`,
      [agentId]
    ),
    query(
      `SELECT
         COUNT(*) as total_qr_codes,
         COUNT(*) FILTER (WHERE is_active = true) as active_qr_codes,
         COALESCE(SUM(scan_count), 0) as total_scans
       FROM qr_codes WHERE agent_id = $1`,
      [agentId]
    ),
    query(
      `SELECT COUNT(*) as scans_this_month
       FROM qr_scans qs
       JOIN qr_codes qc ON qc.id = qs.qr_code_id
       WHERE qc.agent_id = $1
         AND qs.scanned_at >= date_trunc('month', NOW())`,
      [agentId]
    ),
  ]);

  return {
    ...listingStats.rows[0],
    ...qrStats.rows[0],
    scans_this_month: scanStats.rows[0].scans_this_month,
  };
}

// ── DAILY SCANS (last N days) ─────────────────────────────────────────────────
async function getDailyScans(agentId, days = 30) {
  // Generate a full series so days with 0 scans still appear
  const result = await query(
    `WITH date_series AS (
       SELECT generate_series(
         (NOW() - INTERVAL '${days - 1} days')::date,
         NOW()::date,
         '1 day'::interval
       )::date AS date
     ),
     scan_counts AS (
       SELECT DATE(qs.scanned_at) as date, COUNT(*) as scans
       FROM qr_scans qs
       JOIN qr_codes qc ON qc.id = qs.qr_code_id
       WHERE qc.agent_id = $1
         AND qs.scanned_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(qs.scanned_at)
     )
     SELECT
       to_char(ds.date, 'DD Mon') as label,
       ds.date,
       COALESCE(sc.scans, 0)::int as scans
     FROM date_series ds
     LEFT JOIN scan_counts sc ON sc.date = ds.date
     ORDER BY ds.date ASC`,
    [agentId]
  );
  return result.rows;
}

// ── SCANS BY DEVICE ───────────────────────────────────────────────────────────
async function getScansByDevice(agentId, days = 30) {
  const result = await query(
    `SELECT
       COALESCE(qs.device_type, 'unknown') as device,
       COUNT(*) as count,
       ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 1) as percentage
     FROM qr_scans qs
     JOIN qr_codes qc ON qc.id = qs.qr_code_id
     WHERE qc.agent_id = $1
       AND qs.scanned_at >= NOW() - INTERVAL '${days} days'
     GROUP BY qs.device_type
     ORDER BY count DESC`,
    [agentId]
  );
  return result.rows;
}

// ── TOP LISTINGS BY SCANS ─────────────────────────────────────────────────────
async function getTopListings(agentId, limit = 5) {
  const result = await query(
    `SELECT
       l.id, l.title, l.city, l.property_type, l.listing_type,
       l.price, l.status, l.view_count,
       COALESCE(qc.scan_count, 0) as scan_count,
       qc.short_code
     FROM listings l
     LEFT JOIN qr_codes qc ON qc.listing_id = l.id
     WHERE l.agent_id = $1
     ORDER BY COALESCE(qc.scan_count, 0) DESC, l.view_count DESC
     LIMIT $2`,
    [agentId, limit]
  );
  return result.rows;
}

// ── SCANS BY CITY ─────────────────────────────────────────────────────────────
async function getScansByCity(agentId, days = 30) {
  const result = await query(
    `SELECT
       COALESCE(qs.city, 'Unknown') as city,
       COUNT(*) as count
     FROM qr_scans qs
     JOIN qr_codes qc ON qc.id = qs.qr_code_id
     WHERE qc.agent_id = $1
       AND qs.scanned_at >= NOW() - INTERVAL '${days} days'
       AND qs.city IS NOT NULL
     GROUP BY qs.city
     ORDER BY count DESC
     LIMIT 8`,
    [agentId]
  );
  return result.rows;
}

// ── WEEKLY COMPARISON ─────────────────────────────────────────────────────────
async function getWeeklyComparison(agentId) {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE qs.scanned_at >= NOW() - INTERVAL '7 days') as this_week,
       COUNT(*) FILTER (
         WHERE qs.scanned_at >= NOW() - INTERVAL '14 days'
           AND qs.scanned_at < NOW() - INTERVAL '7 days'
       ) as last_week
     FROM qr_scans qs
     JOIN qr_codes qc ON qc.id = qs.qr_code_id
     WHERE qc.agent_id = $1`,
    [agentId]
  );
  const { this_week, last_week } = result.rows[0];
  const diff = parseInt(this_week) - parseInt(last_week);
  const change_pct = last_week > 0
    ? Math.round((diff / parseInt(last_week)) * 100)
    : this_week > 0 ? 100 : 0;

  return { this_week: parseInt(this_week), last_week: parseInt(last_week), change_pct };
}

// ── FULL ANALYTICS BUNDLE ─────────────────────────────────────────────────────
async function getFullAnalytics(agentId, days = 30) {
  const [overview, daily, byDevice, topListings, byCity, weekly] = await Promise.all([
    getOverviewStats(agentId),
    getDailyScans(agentId, days),
    getScansByDevice(agentId, days),
    getTopListings(agentId),
    getScansByCity(agentId, days),
    getWeeklyComparison(agentId),
  ]);

  return { overview, daily, byDevice, topListings, byCity, weekly };
}

module.exports = {
  getOverviewStats,
  getDailyScans,
  getScansByDevice,
  getTopListings,
  getScansByCity,
  getWeeklyComparison,
  getFullAnalytics,
};
