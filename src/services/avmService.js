const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * F12 — AI Property Valuation (AVM)
 *
 * Algorithm:
 *   1. Fetch up to 20 comparable active listings (same city/type, within 30% price range)
 *   2. Compute statistical range: percentile 10th, 50th, 90th of price_per_sqft × input area
 *   3. Send to GPT-4o mini for narrative + confidence adjustment
 *   4. Store result in avm_reports table
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function formatPrice(p) {
  if (p >= 10000000) return `₹${(p / 10000000).toFixed(2)}Cr`;
  if (p >= 100000)   return `₹${(p / 100000).toFixed(1)}L`;
  return `₹${Number(p).toLocaleString('en-IN')}`;
}

/**
 * Run AVM for a listing or arbitrary property params.
 */
async function runValuation({ listingId, city, locality, propertyType, areaSqft, bedrooms, inputPrice, requestedBy }) {
  // Resolve from listing if ID provided
  if (listingId) {
    const lr = await pool.query(
      `SELECT city, locality, property_type, area_sqft, bedrooms, price FROM listings WHERE id=$1`, [listingId]
    );
    if (lr.rows.length) {
      const l = lr.rows[0];
      city        = city        || l.city;
      locality    = locality    || l.locality;
      propertyType = propertyType || l.property_type;
      areaSqft    = areaSqft    || l.area_sqft;
      bedrooms    = bedrooms    || l.bedrooms;
      inputPrice  = inputPrice  || l.price;
    }
  }

  if (!city || !propertyType) throw new Error('city and propertyType are required');

  // ── Step 1: Fetch comparables ─────────────────────────────────────────────
  const conditions = [`l.status = 'active'`, `l.listing_type = 'sale'`, `l.property_type = $1`, `l.city = $2`];
  const params = [propertyType, city];
  let paramIdx = 3;

  if (locality) { conditions.push(`l.locality = $${paramIdx++}`); params.push(locality); }
  if (areaSqft) {
    const minArea = areaSqft * 0.6, maxArea = areaSqft * 1.4;
    conditions.push(`l.area_sqft BETWEEN $${paramIdx++} AND $${paramIdx++}`);
    params.push(minArea, maxArea);
  }
  if (bedrooms) { conditions.push(`l.bedrooms = $${paramIdx++}`); params.push(bedrooms); }
  // Exclude the listing being valued
  if (listingId) { conditions.push(`l.id != $${paramIdx++}`); params.push(listingId); }

  const compRes = await pool.query(
    `SELECT l.id, l.title, l.price, l.area_sqft, l.bedrooms, l.locality, l.city,
            l.floor_number, l.furnishing, l.view_count,
            CASE WHEN l.area_sqft > 0 THEN l.price / l.area_sqft ELSE NULL END AS price_per_sqft
     FROM listings l
     WHERE ${conditions.join(' AND ')}
     ORDER BY l.view_count DESC, l.created_at DESC
     LIMIT 20`,
    params
  );

  const comparables = compRes.rows.filter((c) => c.price_per_sqft !== null);

  // ── Step 2: Statistical range ─────────────────────────────────────────────
  let estimatedLow, estimatedMid, estimatedHigh, confidenceScore;

  if (comparables.length >= 3) {
    const pricesPerSqft = comparables.map((c) => parseFloat(c.price_per_sqft)).sort((a, b) => a - b);
    const percentile = (arr, p) => arr[Math.floor(arr.length * p / 100)];

    const p10 = percentile(pricesPerSqft, 10);
    const p50 = percentile(pricesPerSqft, 50);
    const p90 = percentile(pricesPerSqft, 90);
    const area = areaSqft || 1000;

    estimatedLow  = Math.round(p10 * area);
    estimatedMid  = Math.round(p50 * area);
    estimatedHigh = Math.round(p90 * area);
    confidenceScore = Math.min(95, 50 + comparables.length * 2 + (locality ? 10 : 0));
  } else {
    // Fallback: use market snapshot data
    const snapRes = await pool.query(
      `SELECT avg_price_sqft FROM market_snapshots
       WHERE city=$1 AND property_type=$2 AND listing_type='sale'
         AND snapshot_date = (SELECT MAX(snapshot_date) FROM market_snapshots WHERE city=$1 AND property_type=$2 AND listing_type='sale')
       LIMIT 1`,
      [city, propertyType]
    );
    const sqftPrice = parseFloat(snapRes.rows[0]?.avg_price_sqft || 8000);
    const area      = areaSqft || 1000;
    estimatedLow    = Math.round(sqftPrice * 0.85 * area);
    estimatedMid    = Math.round(sqftPrice * area);
    estimatedHigh   = Math.round(sqftPrice * 1.15 * area);
    confidenceScore = 45; // low confidence without comparables
  }

  // ── Step 3: GPT-4o mini summary ───────────────────────────────────────────
  let aiSummary = `Estimated value based on ${comparables.length} comparable listings in ${locality || city}. ` +
    `Market data suggests a range of ${formatPrice(estimatedLow)} to ${formatPrice(estimatedHigh)}, ` +
    `with a mid-point estimate of ${formatPrice(estimatedMid)}.`;

  if (process.env.OPENAI_API_KEY && comparables.length >= 3) {
    try {
      const prompt = `You are a real estate valuation expert in India. Provide a brief, professional 2-3 sentence valuation summary.

Property: ${bedrooms ? bedrooms + 'BHK ' : ''}${propertyType} in ${locality ? locality + ', ' : ''}${city}
Area: ${areaSqft ? areaSqft + ' sqft' : 'unknown'}
Listed Price: ${inputPrice ? formatPrice(inputPrice) : 'Not listed'}
Our Estimate Range: ${formatPrice(estimatedLow)} – ${formatPrice(estimatedHigh)} (mid: ${formatPrice(estimatedMid)})
Comparables: ${comparables.length} similar active listings
Avg comparable price/sqft: ₹${Math.round(comparables.reduce((s, c) => s + parseFloat(c.price_per_sqft), 0) / comparables.length).toLocaleString('en-IN')}

Write a concise professional summary. Mention if the listed price seems fair, above, or below market. Include one specific market insight for this city/locality. Be direct.`;

      const openaiRes = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 200, temperature: 0.3,
          messages: [{ role: 'user', content: prompt }] }),
      });

      if (openaiRes.ok) {
        const data = await openaiRes.json();
        aiSummary = data.choices?.[0]?.message?.content?.trim() || aiSummary;
      }
    } catch (err) {
      logger.warn(`[AVM] GPT call failed: ${err.message}`);
    }
  }

  // ── Step 4: Store report ──────────────────────────────────────────────────
  const report = await pool.query(
    `INSERT INTO avm_reports
       (listing_id, city, locality, property_type, area_sqft, bedrooms, input_price,
        estimated_low, estimated_mid, estimated_high, confidence_score, comparables_used,
        ai_summary, comparables, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      listingId || null, city, locality || null, propertyType,
      areaSqft || null, bedrooms || null, inputPrice || null,
      estimatedLow, estimatedMid, estimatedHigh,
      confidenceScore, comparables.length,
      aiSummary,
      JSON.stringify(comparables.map((c) => ({ id: c.id, title: c.title, price: c.price, price_per_sqft: c.price_per_sqft, locality: c.locality }))),
      requestedBy || null,
    ]
  );

  return {
    ...report.rows[0],
    comparables: comparables.slice(0, 10),
  };
}

/**
 * Get the latest AVM report for a listing.
 */
async function getLatestReport(listingId) {
  const res = await pool.query(
    `SELECT * FROM avm_reports WHERE listing_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [listingId]
  );
  return res.rows[0] || null;
}

/**
 * Get all reports requested by an agent.
 */
async function getAgentReports(agentId, limit = 20) {
  const res = await pool.query(
    `SELECT ar.*, l.title AS listing_title
     FROM avm_reports ar
     LEFT JOIN listings l ON l.id = ar.listing_id
     WHERE ar.requested_by = $1
     ORDER BY ar.created_at DESC LIMIT $2`,
    [agentId, limit]
  );
  return res.rows;
}

module.exports = { runValuation, getLatestReport, getAgentReports };
