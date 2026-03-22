'use strict';
/**
 * optimizerService.js — Feature 8: AI Optimizer
 *
 * All functions have rule-based fallbacks — works without OpenAI.
 * Results cached in ai_cache with appropriate TTLs.
 */

const { query }       = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const logger          = require('../config/logger');

// Lazy OpenAI loader (same pattern as aiService)
let openai = null;
function getOpenAI() {
  if (openai) return openai;
  if (!process.env.OPENAI_API_KEY) return null;
  try { const { OpenAI } = require('openai'); openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); return openai; }
  catch { return null; }
}

// ── Cache helpers ──────────────────────────────────────────────────────────────
async function getCached(listingId, cacheType) {
  const res = await query(
    `SELECT payload FROM ai_cache WHERE listing_id=$1 AND cache_type=$2 AND expires_at>NOW()`,
    [listingId, cacheType]
  );
  return res.rows[0]?.payload || null;
}

async function setCached(listingId, cacheType, payload, ttlHours = 48) {
  await query(
    `INSERT INTO ai_cache (listing_id, cache_type, payload, expires_at)
     VALUES ($1,$2,$3, NOW() + $4 * INTERVAL '1 hour')
     ON CONFLICT (listing_id, cache_type)
     DO UPDATE SET payload=$3, expires_at=NOW() + $4 * INTERVAL '1 hour', created_at=NOW()`,
    [listingId, cacheType, JSON.stringify(payload), ttlHours]
  );
}

// ── 1. Price Suggestion ───────────────────────────────────────────────────────
async function suggestPrice(listingId, agentId) {
  const listRes = await query(
    `SELECT l.*, u.name AS agent_name FROM listings l JOIN users u ON u.id=l.agent_id
     WHERE l.id=$1 AND l.agent_id=$2`, [listingId, agentId]
  );
  const l = listRes.rows[0];
  if (!l) throw createError('Listing not found', 404);

  const cached = await getCached(listingId, 'price_suggest');
  if (cached) return { ...cached, source: 'cache' };

  // Fetch comparable listings in same city + property type (last 90 days)
  const compRes = await query(
    `SELECT price, area_sqft, bedrooms, floor_number, furnishing,
            view_count, quality_score,
            EXTRACT(DAYS FROM NOW()-created_at) AS days_old
     FROM listings
     WHERE city=$1 AND property_type=$2 AND listing_type=$3
       AND status IN ('active','sold','rented')
       AND id != $4
       AND created_at > NOW() - INTERVAL '90 days'
     ORDER BY quality_score DESC LIMIT 20`,
    [l.city, l.property_type, l.listing_type, listingId]
  );
  const comps = compRes.rows;

  let result;
  const ai = getOpenAI();

  if (ai && comps.length >= 3) {
    try {
      const compSummary = comps.slice(0, 8).map(c =>
        `₹${c.price} | ${c.area_sqft || '?'} sqft | ${c.bedrooms || '?'}BHK | ${c.furnishing || 'unknown'} | score:${c.quality_score}`
      ).join('\n');

      const prompt = `You are a real estate pricing expert in India.

Listing to price:
- ${l.property_type} for ${l.listing_type}
- City: ${l.city}, ${l.state}
- Bedrooms: ${l.bedrooms ?? 'N/A'}, Bathrooms: ${l.bathrooms ?? 'N/A'}
- Area: ${l.area_sqft ? l.area_sqft + ' sqft' : 'N/A'}
- Floor: ${l.floor_number ?? 'N/A'} / ${l.total_floors ?? '?'}
- Furnishing: ${l.furnishing ?? 'unknown'}
- Current price: ₹${l.price}
- Quality score: ${l.quality_score}/100

Comparable listings in same market:
${compSummary}

Respond ONLY with valid JSON, no markdown:
{"suggested_min":0,"suggested_mid":0,"suggested_max":0,"confidence":"high|medium|low","reasoning":"2-3 sentence explanation","price_vs_market":"below|fair|above","adjustment_pct":0}`;

      const resp = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.3,
      });
      result = JSON.parse(resp.choices[0].message.content || '{}');
    } catch (err) {
      logger.warn('OpenAI price suggestion failed:', err.message);
    }
  }

  // Rule-based fallback
  if (!result) {
    if (comps.length > 0) {
      const prices = comps.map(c => c.price).sort((a, b) => a - b);
      const mid    = prices[Math.floor(prices.length / 2)];
      const low    = prices[Math.floor(prices.length * 0.25)];
      const high   = prices[Math.floor(prices.length * 0.75)];

      let vsMarket = 'fair';
      let adjPct   = 0;
      if (l.price < low  * 0.9) { vsMarket = 'below'; adjPct = Math.round((mid - l.price) / l.price * 100); }
      if (l.price > high * 1.1) { vsMarket = 'above'; adjPct = Math.round((l.price - mid) / mid * 100); }

      result = {
        suggested_min:   Math.round(low  / 10000) * 10000,
        suggested_mid:   Math.round(mid  / 10000) * 10000,
        suggested_max:   Math.round(high / 10000) * 10000,
        confidence:      comps.length >= 10 ? 'high' : 'medium',
        price_vs_market: vsMarket,
        adjustment_pct:  adjPct,
        reasoning:       `Based on ${comps.length} comparable ${l.property_type}s for ${l.listing_type} in ${l.city}. Median comparable price is ₹${mid.toLocaleString('en-IN')}.${vsMarket === 'above' ? ' Your listing is priced above market — consider reducing to attract more buyers.' : vsMarket === 'below' ? ' Your listing is below market — you may be leaving money on the table.' : ' Your listing is priced fairly for the market.'}`,
        comps_count:     comps.length,
      };
    } else {
      result = {
        suggested_min: null, suggested_mid: null, suggested_max: null,
        confidence: 'low',
        price_vs_market: 'unknown',
        adjustment_pct: 0,
        reasoning: `Not enough comparable ${l.property_type}s found in ${l.city} to suggest a price. Add more details (area, bedrooms, furnishing) to improve accuracy.`,
        comps_count: 0,
      };
    }
  }

  // Update listings.suggested_price
  if (result.suggested_mid) {
    await query('UPDATE listings SET suggested_price=$1 WHERE id=$2', [result.suggested_mid, listingId]);
  }

  await setCached(listingId, 'price_suggest', result, 48);
  return { ...result, source: ai ? 'openai' : 'rules' };
}

// ── 2. Title Optimizer ────────────────────────────────────────────────────────
async function optimizeTitle(listingId, agentId) {
  const listRes = await query(
    'SELECT * FROM listings WHERE id=$1 AND agent_id=$2', [listingId, agentId]
  );
  const l = listRes.rows[0];
  if (!l) throw createError('Listing not found', 404);

  const cached = await getCached(listingId, 'title_optimize');
  if (cached) return { ...cached, source: 'cache' };

  const ai = getOpenAI();
  let result;

  if (ai) {
    try {
      const prompt = `You are an SEO expert for Indian real estate portals.

Current listing title: "${l.title}"
Property: ${l.property_type} for ${l.listing_type}
City: ${l.city}, ${l.locality || l.state}
Bedrooms: ${l.bedrooms ?? 'N/A'} | Area: ${l.area_sqft ? l.area_sqft + ' sqft' : 'N/A'}
Furnishing: ${l.furnishing ?? 'N/A'}

Generate 3 optimised title variants. Good titles:
- Include BHK count, property type, and locality
- Mention a key selling point (sea view, near metro, corner unit, etc.)
- Use buyer search keywords (₹ price range is NOT in title)
- Are 60-80 characters long

Respond ONLY with valid JSON, no markdown:
{"variants":[{"title":"...", "score":8, "improvements":["added BHK","added locality"]},{"title":"...","score":7,"improvements":["..."]},{"title":"...","score":6,"improvements":["..."]}],"current_score":5,"current_issues":["too vague","missing locality"]}`;

      const resp = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 400,
        temperature: 0.6,
      });
      result = JSON.parse(resp.choices[0].message.content || '{}');
    } catch (err) {
      logger.warn('OpenAI title optimize failed:', err.message);
    }
  }

  // Rule-based fallback
  if (!result) {
    const beds = l.bedrooms ? `${l.bedrooms}BHK ` : '';
    const loc  = l.locality || l.city;
    const fur  = l.furnishing === 'fully-furnished' ? 'Fully Furnished ' : l.furnishing === 'semi-furnished' ? 'Semi Furnished ' : '';
    const area = l.area_sqft ? ` — ${l.area_sqft} sqft` : '';
    const flr  = l.floor_number ? ` | ${l.floor_number === 0 ? 'Ground' : l.floor_number + 'th'} Floor` : '';

    result = {
      current_score: l.title.length > 50 && l.title.toLowerCase().includes(l.city.toLowerCase()) ? 6 : 4,
      current_issues: [
        ...(l.title.length < 30 ? ['Title is too short — add more details'] : []),
        ...(!l.bedrooms ? ['Missing bedroom count'] : []),
        ...(!l.title.toLowerCase().includes(l.city.toLowerCase()) && !l.title.toLowerCase().includes((l.locality || '').toLowerCase()) ? ['Missing location'] : []),
      ],
      variants: [
        { title: `${beds}${l.property_type === 'apartment' ? 'Apartment' : l.property_type === 'villa' ? 'Villa' : 'Property'} for ${l.listing_type === 'sale' ? 'Sale' : 'Rent'} in ${loc}${area}`, score: 7, improvements: ['Added location', 'Added area'] },
        { title: `${fur}${beds}${l.property_type === 'apartment' ? 'Flat' : 'Property'} — ${loc}${flr}`, score: 6, improvements: ['Added furnishing status', 'Added floor'] },
        { title: `${beds}${l.listing_type === 'sale' ? 'For Sale' : 'For Rent'}: ${l.property_type} in ${l.city} | ${l.locality || l.state}`, score: 6, improvements: ['Clearer purpose', 'Added city + locality'] },
      ],
    };
  }

  await setCached(listingId, 'title_optimize', result, 72);
  return { ...result, source: ai ? 'openai' : 'rules' };
}

// ── 3. Amenity Gap Analysis ───────────────────────────────────────────────────
async function analyzeAmenityGap(listingId, agentId) {
  const listRes = await query(
    'SELECT * FROM listings WHERE id=$1 AND agent_id=$2', [listingId, agentId]
  );
  const l = listRes.rows[0];
  if (!l) throw createError('Listing not found', 404);

  const cached = await getCached(listingId, 'amenity_gap');
  if (cached) return { ...cached, source: 'cache' };

  // Find top-performing comparable listings and see what amenities they have
  const compRes = await query(
    `SELECT amenities, quality_score, view_count
     FROM listings
     WHERE city=$1 AND property_type=$2 AND status='active'
       AND quality_score >= 60 AND id != $3
     ORDER BY quality_score DESC, view_count DESC
     LIMIT 30`,
    [l.city, l.property_type, listingId]
  );

  const myAmenities   = new Set((l.amenities || []).map(a => a.toLowerCase()));
  const amenityFreq   = {};

  compRes.rows.forEach(row => {
    (row.amenities || []).forEach(a => {
      const k = a.toLowerCase();
      amenityFreq[k] = (amenityFreq[k] || 0) + 1;
    });
  });

  const total = compRes.rows.length || 1;

  // Amenities you're missing that ≥40% of good comparables have
  const missing = Object.entries(amenityFreq)
    .filter(([a, count]) => !myAmenities.has(a) && count / total >= 0.4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([amenity, count]) => ({
      amenity: amenity.charAt(0).toUpperCase() + amenity.slice(1),
      prevalence_pct: Math.round(count / total * 100),
      impact: count / total >= 0.7 ? 'high' : count / total >= 0.5 ? 'medium' : 'low',
    }));

  // Unique amenities you have that comparables often lack
  const unique = (l.amenities || [])
    .filter(a => !amenityFreq[a.toLowerCase()] || amenityFreq[a.toLowerCase()] / total < 0.3)
    .slice(0, 4);

  const result = {
    current_count:  (l.amenities || []).length,
    missing_amenities: missing,
    unique_selling_amenities: unique,
    comparables_analyzed: compRes.rows.length,
    recommendation: missing.length > 0
      ? `Add ${missing.slice(0, 3).map(m => m.amenity).join(', ')} to match ${Math.round(missing[0]?.prevalence_pct || 0)}%+ of top listings in your market.`
      : 'Your amenity list is competitive for this market.',
  };

  await setCached(listingId, 'amenity_gap', result, 72);
  return { ...result, source: 'rules' };
}

// ── 4. Conversion Score + Predictor ──────────────────────────────────────────
async function predictConversion(listingId, agentId) {
  const listRes = await query(
    `SELECT l.*, COUNT(ld.id) AS lead_count,
            COUNT(qs.id) AS scan_count
     FROM listings l
     LEFT JOIN leads ld ON ld.listing_id=l.id
     LEFT JOIN qr_scans qs ON qs.listing_id=l.id AND qs.event_type='scan'
     WHERE l.id=$1 AND l.agent_id=$2
     GROUP BY l.id`,
    [listingId, agentId]
  );
  const l = listRes.rows[0];
  if (!l) throw createError('Listing not found', 404);

  // Conversion score: weighted factors 0-100
  let score = 0;
  const factors = [];

  // Photos (30 pts)
  const photoCount = l.images?.length || 0;
  const photoScore = Math.min(photoCount * 5, 30);
  score += photoScore;
  if (photoScore < 30) factors.push({ factor: 'Photos', current: `${photoCount} photos`, target: '6+ photos', pts_available: 30 - photoScore, action: 'Add more property photos' });

  // Description (20 pts)
  const wordCount = l.description?.split(/\s+/).length || 0;
  const descScore = wordCount > 150 ? 20 : wordCount > 100 ? 15 : wordCount > 50 ? 10 : 0;
  score += descScore;
  if (descScore < 20) factors.push({ factor: 'Description', current: `${wordCount} words`, target: '150+ words', pts_available: 20 - descScore, action: 'Expand your description with highlights, landmarks, and key features' });

  // Price competitiveness (20 pts)
  const priceCompRes = await query(
    `SELECT AVG(price) AS avg_price FROM listings
     WHERE city=$1 AND property_type=$2 AND listing_type=$3
       AND status IN ('active','sold') AND id!=$4`,
    [l.city, l.property_type, l.listing_type, listingId]
  );
  const avgPrice = parseFloat(priceCompRes.rows[0]?.avg_price || 0);
  const priceRatio = avgPrice > 0 ? l.price / avgPrice : 1;
  const priceScore = priceRatio <= 1.05 ? 20 : priceRatio <= 1.15 ? 12 : 5;
  score += priceScore;
  if (priceScore < 20 && avgPrice > 0) factors.push({ factor: 'Price', current: `₹${l.price.toLocaleString('en-IN')}`, target: `≤₹${Math.round(avgPrice * 1.05).toLocaleString('en-IN')}`, pts_available: 20 - priceScore, action: `Consider pricing within 5% of market avg (₹${Math.round(avgPrice).toLocaleString('en-IN')})` });

  // Active QR (15 pts)
  const qrRes = await query('SELECT id FROM qr_codes WHERE listing_id=$1 AND is_active=true LIMIT 1', [listingId]);
  const qrScore = qrRes.rows.length > 0 ? 15 : 0;
  score += qrScore;
  if (qrScore === 0) factors.push({ factor: 'QR Code', current: 'Not generated', target: 'Active QR code', pts_available: 15, action: 'Generate a QR code for this listing' });

  // Virtual tour (10 pts)
  const tourScore = l.tour_url ? 10 : 0;
  score += tourScore;
  if (tourScore === 0) factors.push({ factor: 'Virtual Tour', current: 'None', target: 'Matterport/YouTube/Vimeo', pts_available: 10, action: 'Add a virtual tour URL to stand out' });

  // Amenities (5 pts)
  const amenityScore = (l.amenities?.length || 0) >= 5 ? 5 : Math.floor((l.amenities?.length || 0));
  score += amenityScore;
  if (amenityScore < 5) factors.push({ factor: 'Amenities', current: `${l.amenities?.length || 0}`, target: '5+ amenities', pts_available: 5 - amenityScore, action: 'Add more amenities — buyers filter by these' });

  // Update conversion_score in DB
  await query('UPDATE listings SET conversion_score=$1 WHERE id=$2', [score, listingId]);

  // Scan-to-lead rate
  const scans = parseInt(l.scan_count) || 0;
  const leads = parseInt(l.lead_count) || 0;
  const convRate = scans > 0 ? ((leads / scans) * 100).toFixed(1) : null;

  return {
    conversion_score: score,
    grade: score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D',
    factors_to_improve: factors.sort((a, b) => b.pts_available - a.pts_available).slice(0, 4),
    stats: {
      qr_scans: scans,
      leads_generated: leads,
      scan_to_lead_rate: convRate ? `${convRate}%` : 'N/A',
    },
    source: 'rules',
  };
}

module.exports = { suggestPrice, optimizeTitle, analyzeAmenityGap, predictConversion };
