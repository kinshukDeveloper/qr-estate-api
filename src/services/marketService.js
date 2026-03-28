const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * F10 — Market Intelligence Dashboard
 *
 * - Daily market snapshot cron aggregates listings data
 * - Trend queries: 30/90/180d price movement per city/type
 * - Heatmap: locality → avg_price_sqft density
 * - Supply/demand: listing count vs lead count ratio
 */

// ── Daily snapshot cron ───────────────────────────────────────────────────────
/**
 * Run once daily. Aggregates current listings into market_snapshots.
 * Called by cron job or /v3/market/snapshot endpoint.
 */
async function takeSnapshot() {
  logger.info('[Market] Taking daily snapshot...');
  const today = new Date().toISOString().split('T')[0];

  const res = await pool.query(
    `INSERT INTO market_snapshots
       (city, locality, property_type, listing_type, avg_price, avg_price_sqft, median_price, total_listings, total_views, total_leads, snapshot_date)
     SELECT
       l.city,
       COALESCE(l.locality, 'Unknown') AS locality,
       l.property_type,
       l.listing_type,
       AVG(l.price)::numeric(15,2),
       AVG(CASE WHEN l.area_sqft > 0 THEN l.price / l.area_sqft ELSE NULL END)::numeric(10,2),
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY l.price)::numeric(15,2),
       COUNT(*)::integer,
       SUM(l.view_count)::integer,
       COUNT(DISTINCT le.id)::integer,
       $1::date
     FROM listings l
     LEFT JOIN leads le ON le.listing_id = l.id
     WHERE l.status = 'active'
     GROUP BY l.city, l.locality, l.property_type, l.listing_type
     ON CONFLICT (city, locality, property_type, listing_type, snapshot_date) DO UPDATE SET
       avg_price        = EXCLUDED.avg_price,
       avg_price_sqft   = EXCLUDED.avg_price_sqft,
       median_price     = EXCLUDED.median_price,
       total_listings   = EXCLUDED.total_listings,
       total_views      = EXCLUDED.total_views,
       total_leads      = EXCLUDED.total_leads
     RETURNING id`,
    [today]
  );

  logger.info(`[Market] Snapshot done: ${res.rowCount} city/locality/type combos`);
  return { snapshotDate: today, rowsUpserted: res.rowCount };
}

// ── Price trend ───────────────────────────────────────────────────────────────
/**
 * Returns avg_price_sqft over time for a city+type combination.
 * Used for the trend line chart on Market Intelligence page.
 */
async function getPriceTrend({ city, propertyType = 'apartment', listingType = 'sale', days = 90, locality = null }) {
  const conditions = [`city = $1`, `property_type = $2`, `listing_type = $3`, `snapshot_date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'`];
  const params = [city, propertyType, listingType];
  if (locality) { conditions.push(`locality = $4`); params.push(locality); }

  const res = await pool.query(
    `SELECT
       snapshot_date,
       AVG(avg_price_sqft)::numeric(10,2) AS avg_price_sqft,
       AVG(avg_price)::numeric(15,2) AS avg_price,
       SUM(total_listings) AS total_listings,
       SUM(total_leads) AS total_leads
     FROM market_snapshots
     WHERE ${conditions.join(' AND ')}
     GROUP BY snapshot_date
     ORDER BY snapshot_date ASC`,
    params
  );
  return res.rows;
}

// ── Heatmap data ──────────────────────────────────────────────────────────────
/**
 * Returns latest avg_price_sqft per locality for a city.
 * Frontend renders this as a colour-intensity list/map.
 */
async function getHeatmap({ city, propertyType = 'apartment', listingType = 'sale' }) {
  const res = await pool.query(
    `SELECT
       locality,
       avg_price_sqft,
       total_listings,
       total_leads,
       snapshot_date
     FROM market_snapshots
     WHERE city=$1 AND property_type=$2 AND listing_type=$3
       AND snapshot_date = (
         SELECT MAX(snapshot_date) FROM market_snapshots
         WHERE city=$1 AND property_type=$2 AND listing_type=$3
       )
     ORDER BY avg_price_sqft DESC`,
    [city, propertyType, listingType]
  );
  return res.rows;
}

// ── City summary ──────────────────────────────────────────────────────────────
/**
 * High-level KPIs for a city: total active listings, median price, YoY change, top locality.
 */
async function getCitySummary(city) {
  // Latest snapshot
  const latestRes = await pool.query(
    `SELECT
       SUM(total_listings) AS total_listings,
       AVG(avg_price_sqft) AS avg_price_sqft,
       SUM(total_leads) AS total_leads,
       MAX(snapshot_date) AS latest_date
     FROM market_snapshots
     WHERE city=$1 AND snapshot_date = (SELECT MAX(snapshot_date) FROM market_snapshots WHERE city=$1)`,
    [city]
  );

  // 90-day-ago snapshot for comparison
  const oldRes = await pool.query(
    `SELECT AVG(avg_price_sqft) AS avg_price_sqft
     FROM market_snapshots
     WHERE city=$1 AND snapshot_date BETWEEN CURRENT_DATE - INTERVAL '95 days' AND CURRENT_DATE - INTERVAL '85 days'`,
    [city]
  );

  const latest  = latestRes.rows[0];
  const oldSqft = parseFloat(oldRes.rows[0]?.avg_price_sqft || latest?.avg_price_sqft);
  const newSqft = parseFloat(latest?.avg_price_sqft || 0);
  const pctChange = oldSqft ? (((newSqft - oldSqft) / oldSqft) * 100).toFixed(1) : null;

  // Top locality by views
  const topLocalityRes = await pool.query(
    `SELECT locality, SUM(total_views) AS total_views
     FROM market_snapshots WHERE city=$1 AND snapshot_date = (SELECT MAX(snapshot_date) FROM market_snapshots WHERE city=$1)
     GROUP BY locality ORDER BY total_views DESC LIMIT 1`,
    [city]
  );

  return {
    city,
    total_listings:    parseInt(latest?.total_listings || 0),
    avg_price_sqft:    Math.round(newSqft),
    total_leads:       parseInt(latest?.total_leads || 0),
    price_change_90d:  pctChange ? parseFloat(pctChange) : null,
    top_locality:      topLocalityRes.rows[0]?.locality || null,
    as_of:             latest?.latest_date,
  };
}

// ── Available cities ──────────────────────────────────────────────────────────
async function getAvailableCities() {
  const res = await pool.query(
    `SELECT DISTINCT city FROM market_snapshots ORDER BY city`
  );
  return res.rows.map((r) => r.city);
}

// ── Supply vs demand ──────────────────────────────────────────────────────────
async function getSupplyDemand({ city, days = 30 }) {
  const res = await pool.query(
    `SELECT
       locality,
       property_type,
       AVG(total_listings) AS avg_supply,
       AVG(total_leads) AS avg_demand,
       CASE WHEN AVG(total_listings) > 0
         THEN (AVG(total_leads) / AVG(total_listings))::numeric(6,2)
         ELSE 0 END AS demand_supply_ratio
     FROM market_snapshots
     WHERE city=$1 AND snapshot_date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
     GROUP BY locality, property_type
     ORDER BY demand_supply_ratio DESC
     LIMIT 20`,
    [city]
  );
  return res.rows;
}

module.exports = { takeSnapshot, getPriceTrend, getHeatmap, getCitySummary, getAvailableCities, getSupplyDemand };
