/**
 * aiService.js — Conversion Intelligence AI
 *
 * Feature 2: quality scoring, OpenAI tips, description writer, photo checker
 *
 * All OpenAI calls have rule-based fallbacks — app works without OPENAI_API_KEY.
 */

const { query } = require('../config/database');
const { setEx, get: redisGet } = require('../config/redis');
const { createError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// ── OpenAI client (lazy-loaded so app starts without key) ─────────────────────
let openai = null;

function getOpenAI() {
  if (openai) return openai;
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — AI will use rule-based fallbacks');
    return null;
  }
  try {
    const { OpenAI } = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai;
  } catch {
    logger.warn('openai package not installed — run: npm install openai');
    return null;
  }
}

// ── Quality scoring ───────────────────────────────────────────────────────────

/**
 * Score breakdown (max 100 pts):
 *   Photos        — 20 pts  (has ≥1 image)
 *   Description   — 20 pts  (>100 words)
 *   Floor number  — 10 pts
 *   Furnishing    — 10 pts
 *   Amenities     — 15 pts  (≥3 amenities)
 *   Area sqft     — 10 pts
 *   Active QR     — 15 pts  (has linked active QR code)
 */
async function computeQualityScore(listingId) {
  const result = await query(
    `SELECT
       l.images, l.description, l.floor_number, l.furnishing,
       l.amenities, l.area_sqft,
       COUNT(q.id) FILTER (WHERE q.is_active = true) AS active_qr_count
     FROM listings l
     LEFT JOIN qr_codes q ON q.listing_id = l.id
     WHERE l.id = $1
     GROUP BY l.id`,
    [listingId]
  );

  const listing = result.rows[0];
  if (!listing) throw createError('Listing not found', 404);

  const breakdown = {
    photos:      listing.images?.length > 0 ? 20 : 0,
    description: listing.description && listing.description.split(/\s+/).length > 100 ? 20 : 0,
    floor:       listing.floor_number != null ? 10 : 0,
    furnishing:  listing.furnishing ? 10 : 0,
    amenities:   (listing.amenities?.length || 0) >= 3 ? 15 : 0,
    area:        listing.area_sqft ? 10 : 0,
    active_qr:   parseInt(listing.active_qr_count) > 0 ? 15 : 0,
  };

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // Persist
  await query(
    `UPDATE listings SET quality_score = $1, quality_breakdown = $2, updated_at = NOW()
     WHERE id = $3`,
    [score, JSON.stringify(breakdown), listingId]
  );

  return { score, breakdown, max: 100 };
}

// ── Rule-based tips (fallback when OpenAI is unavailable) ─────────────────────
function getRuleBasedTips(listing) {
  const tips = [];

  if (!listing.images || listing.images.length === 0) {
    tips.push({ icon: '📸', tip: 'Add at least 6 photos — listings with photos get 3× more enquiries. Include entrance, living room, kitchen, master bedroom, bathroom, and building exterior.' });
  } else if (listing.images.length < 4) {
    tips.push({ icon: '📸', tip: `You have ${listing.images.length} photo(s). Add ${6 - listing.images.length} more to reach 6 — the sweet spot for buyer engagement.` });
  }

  if (!listing.description || listing.description.split(/\s+/).length < 100) {
    tips.push({ icon: '✍️', tip: 'Your description is under 100 words. Buyers want to know: natural light, ventilation, nearby landmarks, connectivity, and what makes this property special.' });
  }

  if (!listing.area_sqft) {
    tips.push({ icon: '📐', tip: 'Add the carpet area in sq.ft — it\'s the #1 search filter buyers use. Missing area reduces visibility in search results.' });
  }

  if (!listing.furnishing) {
    tips.push({ icon: '🛋️', tip: 'Set the furnishing status (unfurnished/semi/fully furnished). Buyers filter by this — missing it means missed searches.' });
  }

  if (!listing.floor_number) {
    tips.push({ icon: '🏢', tip: 'Add the floor number. Ground floor and top floor have different buyer audiences — make sure yours shows up for the right one.' });
  }

  if ((listing.amenities?.length || 0) < 3) {
    tips.push({ icon: '✅', tip: 'Add at least 3 amenities (Lift, Parking, Power Backup etc.) — buyers filter by amenities heavily. More amenities = more discoverability.' });
  }

  // Keep top 3
  return tips.slice(0, 3);
}

// ── AI Listing Tips ───────────────────────────────────────────────────────────
async function getListingTips(listingId, agentId) {
  const result = await query(
    `SELECT l.*, u.name AS agent_name
     FROM listings l JOIN users u ON u.id = l.agent_id
     WHERE l.id = $1 AND l.agent_id = $2`,
    [listingId, agentId]
  );
  const listing = result.rows[0];
  if (!listing) throw createError('Listing not found', 404);

  // Check DB cache first (24h TTL)
  const cacheResult = await query(
    `SELECT payload FROM ai_cache
     WHERE listing_id = $1 AND cache_type = 'tips' AND expires_at > NOW()`,
    [listingId]
  );
  if (cacheResult.rows[0]) {
    return { tips: cacheResult.rows[0].payload.tips, source: 'cache' };
  }

  // Attempt OpenAI
  const ai = getOpenAI();
  let tips = null;

  if (ai) {
    try {
      const prompt = `You are a senior real estate advisor in India specialising in digital marketing and buyer conversion.

A real estate agent has this listing:
- Title: ${listing.title}
- Type: ${listing.property_type} for ${listing.listing_type}
- Price: ₹${Number(listing.price).toLocaleString('en-IN')}
- City: ${listing.city}, ${listing.state}
- Bedrooms: ${listing.bedrooms ?? 'not set'}
- Bathrooms: ${listing.bathrooms ?? 'not set'}
- Area: ${listing.area_sqft ? listing.area_sqft + ' sq.ft' : 'not set'}
- Furnishing: ${listing.furnishing ?? 'not set'}
- Floor: ${listing.floor_number ?? 'not set'} of ${listing.total_floors ?? '?'}
- Description length: ${listing.description ? listing.description.split(/\s+/).length + ' words' : '0 words'}
- Photos count: ${listing.images?.length ?? 0}
- Amenities: ${listing.amenities?.join(', ') || 'none listed'}
- Quality score: ${listing.quality_score}/100

Give exactly 3 specific, actionable tips to improve scan-to-enquiry conversion for this listing.
Each tip must be specific to THIS listing — not generic advice.
Respond ONLY with valid JSON in this exact format, no markdown, no explanation:
{"tips":[{"icon":"emoji","tip":"specific advice here"},{"icon":"emoji","tip":"..."},{"icon":"emoji","tip":"..."}]}`;

      const response = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 500,
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      tips = parsed.tips || null;
    } catch (err) {
      logger.warn('OpenAI tips error — using fallback:', err.message);
    }
  }

  // Fallback to rule-based
  if (!tips) {
    tips = getRuleBasedTips(listing);
  }

  // Cache in DB for 24h
  await query(
    `INSERT INTO ai_cache (listing_id, cache_type, payload, expires_at)
     VALUES ($1, 'tips', $2, NOW() + INTERVAL '24 hours')
     ON CONFLICT (listing_id, cache_type)
     DO UPDATE SET payload = $2, expires_at = NOW() + INTERVAL '24 hours', created_at = NOW()`,
    [listingId, JSON.stringify({ tips })]
  );

  const source = ai ? 'openai' : 'rules';
  return { tips, source };
}

// ── AI Description Writer ─────────────────────────────────────────────────────
async function writeDescription(listingId, agentId) {
  const result = await query(
    `SELECT * FROM listings WHERE id = $1 AND agent_id = $2`,
    [listingId, agentId]
  );
  const listing = result.rows[0];
  if (!listing) throw createError('Listing not found', 404);

  // Cache check (12h)
  const cacheResult = await query(
    `SELECT payload FROM ai_cache
     WHERE listing_id = $1 AND cache_type = 'description' AND expires_at > NOW()`,
    [listingId]
  );
  if (cacheResult.rows[0]) {
    return { variants: cacheResult.rows[0].payload.variants, source: 'cache' };
  }

  const ai = getOpenAI();
  let variants = null;

  if (ai) {
    try {
      const prompt = `You are a real estate copywriter specialising in Indian residential and commercial property.

Write 3 compelling property descriptions for this listing:
- Property: ${listing.property_type} for ${listing.listing_type}
- Title: ${listing.title}
- City: ${listing.city}, ${listing.locality || ''}, ${listing.state}
- Price: ₹${Number(listing.price).toLocaleString('en-IN')}
- Bedrooms: ${listing.bedrooms ?? 'N/A'}, Bathrooms: ${listing.bathrooms ?? 'N/A'}
- Area: ${listing.area_sqft ? listing.area_sqft + ' sq.ft' : 'N/A'}
- Floor: ${listing.floor_number ?? 'N/A'} of ${listing.total_floors ?? 'N/A'}
- Furnishing: ${listing.furnishing ?? 'unfurnished'}
- Amenities: ${listing.amenities?.join(', ') || 'none'}
- Facing: ${listing.facing ?? 'N/A'}

Write 3 variants: SHORT (40-60 words), MEDIUM (80-120 words), DETAILED (150-200 words).
Use natural Indian English. Mention RERA if applicable. Be specific and compelling.
Respond ONLY with valid JSON, no markdown:
{"variants":[{"label":"Short","words":50,"text":"..."},{"label":"Medium","words":100,"text":"..."},{"label":"Detailed","words":175,"text":"..."}]}`;

      const response = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.75,
        max_tokens: 800,
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      variants = parsed.variants || null;
    } catch (err) {
      logger.warn('OpenAI description error:', err.message);
    }
  }

  // Rule-based fallback
  if (!variants) {
    const area = listing.area_sqft ? `${listing.area_sqft} sq.ft` : '';
    const beds = listing.bedrooms ? `${listing.bedrooms}BHK` : '';
    const loc  = [listing.locality, listing.city].filter(Boolean).join(', ');
    const fur  = listing.furnishing === 'fully-furnished' ? 'Fully furnished. ' : listing.furnishing === 'semi-furnished' ? 'Semi-furnished. ' : '';

    variants = [
      {
        label: 'Short',
        words: 45,
        text: `${beds} ${listing.property_type} for ${listing.listing_type} in ${loc}. ${area ? area + '. ' : ''}${fur}Excellent connectivity and amenities. Priced at ₹${Number(listing.price).toLocaleString('en-IN')}. Contact agent for site visit.`,
      },
      {
        label: 'Medium',
        words: 90,
        text: `Well-presented ${beds} ${listing.property_type} available for ${listing.listing_type} in the heart of ${loc}. ${area ? `Spanning ${area}, ` : ''}this property offers ${listing.bathrooms ? listing.bathrooms + ' bathrooms, ' : ''}${listing.furnishing ? listing.furnishing + ' condition, ' : ''}and easy access to schools, hospitals and transport links. ${listing.amenities?.length ? 'Key amenities include ' + listing.amenities.slice(0, 3).join(', ') + '. ' : ''}Priced at ₹${Number(listing.price).toLocaleString('en-IN')}${listing.price_negotiable ? ' (negotiable)' : ''}. Serious inquiries welcome.`,
      },
      {
        label: 'Detailed',
        words: 160,
        text: `Presenting a ${listing.price_negotiable ? 'competitively priced, negotiable ' : ''}${beds} ${listing.property_type} for ${listing.listing_type} in ${loc}. ${area ? `This spacious ${area} unit is located on floor ${listing.floor_number ?? 'N/A'} of ${listing.total_floors ?? 'N/A'}, ` : ''}offering an ideal blend of comfort and convenience. ${fur}The property benefits from ${listing.amenities?.join(', ') || 'essential amenities'}. ${listing.facing ? `Facing ${listing.facing} — great for natural light and ventilation. ` : ''}Located in ${listing.city}, residents enjoy proximity to key business districts, reputed schools, and major transit routes. Priced at ₹${Number(listing.price).toLocaleString('en-IN')} — a strong value proposition in today's market. RERA-compliant. Schedule a site visit today.`,
      },
    ];
  }

  // Cache 12h
  await query(
    `INSERT INTO ai_cache (listing_id, cache_type, payload, expires_at)
     VALUES ($1, 'description', $2, NOW() + INTERVAL '12 hours')
     ON CONFLICT (listing_id, cache_type)
     DO UPDATE SET payload = $2, expires_at = NOW() + INTERVAL '12 hours', created_at = NOW()`,
    [listingId, JSON.stringify({ variants })]
  );

  return { variants, source: ai ? 'openai' : 'rules' };
}

// ── AI Photo Checker ──────────────────────────────────────────────────────────
async function checkPhotos(listingId, agentId) {
  const result = await query(
    `SELECT images FROM listings WHERE id = $1 AND agent_id = $2`,
    [listingId, agentId]
  );
  const listing = result.rows[0];
  if (!listing) throw createError('Listing not found', 404);

  const images = listing.images || [];
  if (images.length === 0) {
    return { results: [], message: 'No photos to check. Upload images first.', source: 'rules' };
  }

  // Cache check (6h)
  const cacheResult = await query(
    `SELECT payload FROM ai_cache
     WHERE listing_id = $1 AND cache_type = 'photo_check' AND expires_at > NOW()`,
    [listingId]
  );
  if (cacheResult.rows[0]) {
    return { ...cacheResult.rows[0].payload, source: 'cache' };
  }

  const ai = getOpenAI();
  let results = null;

  if (ai) {
    try {
      // Use first 3 images (GPT-4o Vision)
      const photoUrls = images.slice(0, 3).map(img => img.url).filter(Boolean);

      if (photoUrls.length > 0) {
        const content = [
          {
            type: 'text',
            text: `Analyse these real estate property photos for a listing in India.
For each photo provide: score (0-10), and up to 2 issues from this list: "blurry", "dark lighting", "watermark", "cluttered", "poor angle", "small room effect", "exterior only", "no natural light".
Respond ONLY with valid JSON, no markdown:
{"results":[{"url":"...","score":7,"issues":["dark lighting"],"suggestion":"Open the curtains and shoot during golden hour for best results."}]}`,
          },
          ...photoUrls.map(url => ({
            type: 'image_url',
            image_url: { url, detail: 'low' },
          })),
        ];

        const response = await ai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content }],
          response_format: { type: 'json_object' },
          max_tokens: 600,
        });

        const parsed = JSON.parse(response.choices[0].message.content || '{}');
        results = parsed.results || null;
      }
    } catch (err) {
      logger.warn('OpenAI photo check error:', err.message);
    }
  }

  // Rule-based fallback — just score by count
  if (!results) {
    results = images.slice(0, 3).map((img, i) => ({
      url: img.url,
      score: 7,
      issues: i === 0 && images.length < 4 ? ['few_photos'] : [],
      suggestion: i === 0 && images.length < 4
        ? `Only ${images.length} photo(s) uploaded. Add at least 6 for best conversion.`
        : 'Photo looks good. Ensure good lighting and clean background.',
    }));
  }

  const payload = { results };

  // Cache 6h
  await query(
    `INSERT INTO ai_cache (listing_id, cache_type, payload, expires_at)
     VALUES ($1, 'photo_check', $2, NOW() + INTERVAL '6 hours')
     ON CONFLICT (listing_id, cache_type)
     DO UPDATE SET payload = $2, expires_at = NOW() + INTERVAL '6 hours', created_at = NOW()`,
    [listingId, JSON.stringify(payload)]
  );

  return { ...payload, source: ai ? 'openai' : 'rules' };
}

// ── Invalidate cache (call after listing update) ──────────────────────────────
async function invalidateCache(listingId) {
  await query('DELETE FROM ai_cache WHERE listing_id = $1', [listingId]);
}

// ── Get quality score for a listing (public, no OpenAI needed) ────────────────
async function getQualityScore(listingId, agentId) {
  // Always recompute (fast, pure SQL)
  const qs = await computeQualityScore(listingId);
  return qs;
}

module.exports = {
  computeQualityScore,
  getListingTips,
  writeDescription,
  checkPhotos,
  invalidateCache,
  getQualityScore,
};
