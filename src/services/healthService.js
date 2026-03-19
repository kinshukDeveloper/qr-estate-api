const { query } = require('../config/database');
const logger = require('../config/logger');

// ── GET HEALTH REPORT FOR AGENT ───────────────────────────────────────────────
async function getHealthReport(agentId) {
  const [deadQRs, staleListings, noQRListings, scanDrops, healthScore] = await Promise.all([
    getDeadQRs(agentId),
    getStaleListings(agentId),
    getListingsWithoutQR(agentId),
    getScanDrops(agentId),
    computeHealthScore(agentId),
  ]);

  return {
    health_score: healthScore,
    issues: {
      dead_qr_codes: deadQRs,
      stale_listings: staleListings,
      listings_without_qr: noQRListings,
      scan_drops: scanDrops,
    },
    summary: buildSummary(deadQRs, staleListings, noQRListings, scanDrops),
  };
}

// ── DEAD QR CODES (inactive or pointing to sold/rented listings) ──────────────
async function getDeadQRs(agentId) {
  const result = await query(
    `SELECT
       q.id, q.short_code, q.scan_count, q.is_active,
       q.created_at, q.updated_at,
       l.title as listing_title, l.status as listing_status, l.city
     FROM qr_codes q
     JOIN listings l ON l.id = q.listing_id
     WHERE q.agent_id = $1
       AND (q.is_active = false OR l.status IN ('sold','rented','inactive'))
     ORDER BY q.scan_count DESC`,
    [agentId]
  );
  return result.rows;
}

// ── STALE LISTINGS (active but not updated in 60+ days) ──────────────────────
async function getStaleListings(agentId) {
  const result = await query(
    `SELECT
       id, title, city, status, price, listing_type,
       view_count, updated_at,
       EXTRACT(DAY FROM NOW() - updated_at)::int as days_since_update
     FROM listings
     WHERE agent_id = $1
       AND status = 'active'
       AND updated_at < NOW() - INTERVAL '60 days'
     ORDER BY updated_at ASC`,
    [agentId]
  );
  return result.rows;
}

// ── ACTIVE LISTINGS WITHOUT QR CODE ──────────────────────────────────────────
async function getListingsWithoutQR(agentId) {
  const result = await query(
    `SELECT l.id, l.title, l.city, l.status, l.price, l.listing_type, l.created_at
     FROM listings l
     LEFT JOIN qr_codes q ON q.listing_id = l.id
     WHERE l.agent_id = $1
       AND l.status = 'active'
       AND q.id IS NULL
     ORDER BY l.created_at DESC`,
    [agentId]
  );
  return result.rows;
}

// ── SCAN DROPS (QRs with 0 scans in last 14 days but had scans before) ────────
async function getScanDrops(agentId) {
  const result = await query(
    `SELECT
       q.id, q.short_code, q.scan_count as total_scans,
       l.title as listing_title, l.city,
       COUNT(qs.id) FILTER (WHERE qs.scanned_at >= NOW() - INTERVAL '14 days') as recent_scans,
       COUNT(qs.id) FILTER (WHERE qs.scanned_at < NOW() - INTERVAL '14 days'
                             AND qs.scanned_at >= NOW() - INTERVAL '28 days') as prev_scans
     FROM qr_codes q
     JOIN listings l ON l.id = q.listing_id
     LEFT JOIN qr_scans qs ON qs.qr_code_id = q.id
     WHERE q.agent_id = $1
       AND q.is_active = true
       AND l.status = 'active'
     GROUP BY q.id, q.short_code, q.scan_count, l.title, l.city
     HAVING
       COUNT(qs.id) FILTER (WHERE qs.scanned_at >= NOW() - INTERVAL '14 days') = 0
       AND COUNT(qs.id) FILTER (WHERE qs.scanned_at < NOW() - INTERVAL '14 days'
                                  AND qs.scanned_at >= NOW() - INTERVAL '28 days') > 0
     ORDER BY prev_scans DESC`,
    [agentId]
  );
  return result.rows;
}

// ── HEALTH SCORE (0–100) ──────────────────────────────────────────────────────
async function computeHealthScore(agentId) {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE l.status = 'active') as active_listings,
       COUNT(*) FILTER (WHERE l.status = 'active' AND q.id IS NOT NULL) as active_with_qr,
       COUNT(*) FILTER (WHERE l.status = 'active' AND q.is_active = true) as active_qr_on,
       COUNT(*) FILTER (WHERE l.status = 'active' AND l.updated_at >= NOW() - INTERVAL '60 days') as fresh_listings
     FROM listings l
     LEFT JOIN qr_codes q ON q.listing_id = l.id
     WHERE l.agent_id = $1`,
    [agentId]
  );

  const {
    active_listings,
    active_with_qr,
    active_qr_on,
    fresh_listings,
  } = result.rows[0];

  const total = parseInt(active_listings) || 1;
  const qrCoverage = parseInt(active_with_qr) / total;
  const qrActive = parseInt(active_qr_on) / total;
  const freshness = parseInt(fresh_listings) / total;

  const score = Math.round((qrCoverage * 40 + qrActive * 30 + freshness * 30));
  return Math.min(100, Math.max(0, score));
}

// ── BUILD SUMMARY ─────────────────────────────────────────────────────────────
function buildSummary(deadQRs, staleListings, noQRListings, scanDrops) {
  const issues = [];
  if (deadQRs.length > 0) issues.push(`${deadQRs.length} inactive or dead QR code${deadQRs.length > 1 ? 's' : ''}`);
  if (noQRListings.length > 0) issues.push(`${noQRListings.length} active listing${noQRListings.length > 1 ? 's' : ''} missing a QR code`);
  if (staleListings.length > 0) issues.push(`${staleListings.length} listing${staleListings.length > 1 ? 's' : ''} not updated in 60+ days`);
  if (scanDrops.length > 0) issues.push(`${scanDrops.length} QR code${scanDrops.length > 1 ? 's' : ''} with no scans in last 14 days`);

  if (issues.length === 0) return { status: 'healthy', message: 'All systems healthy. Great work!' };
  if (issues.length <= 1) return { status: 'warning', message: `Minor issue: ${issues[0]}` };
  return { status: 'critical', message: `${issues.length} issues found: ${issues.join(', ')}` };
}

// ── CRON: Run health check for all agents (called by scheduler) ───────────────
async function runGlobalHealthCheck() {
  logger.info('Running QR health check...');
  try {
    const agentsResult = await query(
      "SELECT id FROM users WHERE role IN ('agent', 'agency_admin') AND is_active = true"
    );
    let totalIssues = 0;

    for (const agent of agentsResult.rows) {
      const report = await getHealthReport(agent.id);
      const issueCount = Object.values(report.issues).reduce((sum, arr) => sum + arr.length, 0);
      totalIssues += issueCount;
    }

    logger.info(`Health check complete — ${agentsResult.rows.length} agents, ${totalIssues} total issues`);
  } catch (err) {
    logger.error('Health check failed:', err.message);
  }
}

module.exports = {
  getHealthReport,
  getDeadQRs,
  getStaleListings,
  getListingsWithoutQR,
  getScanDrops,
  runGlobalHealthCheck,
};
