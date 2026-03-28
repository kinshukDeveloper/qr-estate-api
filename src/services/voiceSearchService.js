const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * F04 — Voice Search Service
 * Takes a natural language transcript, extracts structured filters via GPT-4o mini,
 * runs the listing query, logs the interaction.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Parse a voice transcript into listing search filters using GPT-4o mini.
 * Returns a structured filter object.
 */
async function parseTranscript(transcript) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('[VoiceSearch] OPENAI_API_KEY not set — using fallback parser');
    return fallbackParser(transcript);
  }

  const systemPrompt = `You are a real estate search filter extractor for an Indian real estate platform.
Extract search filters from the user's voice query and return ONLY valid JSON.

Available property types: apartment, villa, house, plot, commercial, pg
Available listing types: sale, rent
Available furnishing: furnished, semi-furnished, unfurnished
Price always in INR (Indian Rupees). Convert shorthand: "2 crore" = 20000000, "50 lakh" = 5000000, "1.5cr" = 15000000.

Return this exact JSON structure (use null for any field not mentioned):
{
  "city": string | null,
  "locality": string | null,
  "property_type": string | null,
  "listing_type": "sale" | "rent" | null,
  "bedrooms": number | null,
  "min_price": number | null,
  "max_price": number | null,
  "min_area_sqft": number | null,
  "max_area_sqft": number | null,
  "furnishing": string | null
}`;

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error(`[VoiceSearch] OpenAI error: ${err}`);
    return fallbackParser(transcript);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    logger.warn(`[VoiceSearch] Could not parse GPT response: ${raw}`);
    return fallbackParser(transcript);
  }
}

/**
 * Fallback parser using simple regex when OpenAI is unavailable.
 */
function fallbackParser(transcript) {
  const t = transcript.toLowerCase();
  const filters = {};

  // BHK / bedrooms
  const bedroomMatch = t.match(/(\d)\s*(?:bhk|bedroom|bed)/);
  if (bedroomMatch) filters.bedrooms = parseInt(bedroomMatch[1], 10);

  // Property type
  const typeMap = { apartment: 'apartment', flat: 'apartment', villa: 'villa', house: 'house', plot: 'plot', commercial: 'commercial', pg: 'pg' };
  for (const [keyword, type] of Object.entries(typeMap)) {
    if (t.includes(keyword)) { filters.property_type = type; break; }
  }

  // Listing type
  if (t.includes(' rent') || t.includes('rental')) filters.listing_type = 'rent';
  else if (t.includes(' sale') || t.includes('buy') || t.includes('purchase')) filters.listing_type = 'sale';

  // Price — crore/lakh parsing
  const croreMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:crore|cr)/);
  if (croreMatch) {
    const val = parseFloat(croreMatch[1]) * 10000000;
    if (t.includes('under') || t.includes('below') || t.includes('max') || t.includes('upto')) filters.max_price = val;
    else if (t.includes('above') || t.includes('min') || t.includes('more than')) filters.min_price = val;
    else filters.max_price = val;
  }

  const lakhMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:lakh|l\b)/);
  if (lakhMatch) {
    const val = parseFloat(lakhMatch[1]) * 100000;
    if (t.includes('under') || t.includes('below')) filters.max_price = val;
    else filters.min_price = val;
  }

  return filters;
}

/**
 * Execute a listing search with the parsed filters.
 */
async function searchListings(filters, { page = 1, limit = 20 } = {}) {
  const conditions = [`l.status = 'active'`];
  const params = [];
  let paramIdx = 1;

  const add = (condition, value) => {
    conditions.push(condition.replace('?', `$${paramIdx++}`));
    params.push(value);
  };

  if (filters.city) add(`l.city ILIKE ?`, `%${filters.city}%`);
  if (filters.locality) add(`l.locality ILIKE ?`, `%${filters.locality}%`);
  if (filters.property_type) add(`l.property_type = ?`, filters.property_type);
  if (filters.listing_type) add(`l.listing_type = ?`, filters.listing_type);
  if (filters.bedrooms) add(`l.bedrooms = ?`, filters.bedrooms);
  if (filters.min_price) add(`l.price >= ?`, filters.min_price);
  if (filters.max_price) add(`l.price <= ?`, filters.max_price);
  if (filters.min_area_sqft) add(`l.area_sqft >= ?`, filters.min_area_sqft);
  if (filters.max_area_sqft) add(`l.area_sqft <= ?`, filters.max_area_sqft);
  if (filters.furnishing) add(`l.furnishing = ?`, filters.furnishing);

  const offset = (page - 1) * limit;

  const query = `
    SELECT
      l.id, l.title, l.price, l.property_type, l.listing_type,
      l.bedrooms, l.bathrooms, l.area_sqft,
      l.address, l.locality, l.city, l.state,
      l.images, l.status, l.short_code, l.view_count,
      u.name AS agent_name,
      (SELECT COUNT(*) FROM saved_listings s WHERE s.listing_id = l.id) AS save_count
    FROM listings l
    JOIN users u ON u.id = l.agent_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY l.view_count DESC, l.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countQuery = `
    SELECT COUNT(*) FROM listings l
    WHERE ${conditions.join(' AND ')}
  `;

  const [results, countRes] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, params),
  ]);

  return {
    listings: results.rows,
    pagination: {
      total: parseInt(countRes.rows[0].count, 10),
      page,
      limit,
      pages: Math.ceil(countRes.rows[0].count / limit),
    },
  };
}

/**
 * Main entry point — parse transcript + search + log
 */
async function voiceSearch(transcript, userId, sessionToken, paginationOpts = {}) {
  const filters = await parseTranscript(transcript);
  const { listings, pagination } = await searchListings(filters, paginationOpts);

  // Log async (don't await, don't fail the request)
  pool.query(
    `INSERT INTO voice_search_logs (transcript, parsed_filters, results_count, user_id, session_token)
     VALUES ($1, $2, $3, $4, $5)`,
    [transcript, JSON.stringify(filters), pagination.total, userId || null, sessionToken || null]
  ).catch((err) => logger.warn(`[VoiceSearch] Log failed: ${err.message}`));

  return { filters, listings, pagination };
}

module.exports = { voiceSearch, parseTranscript };
