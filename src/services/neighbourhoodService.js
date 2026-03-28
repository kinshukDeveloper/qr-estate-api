const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * F11 — Neighbourhood Intelligence
 *
 * Fetches POIs within 2km of a listing using Google Places API.
 * Results are cached in neighbourhood_pois table (7-day TTL).
 * Falls back to cached data if API unavailable.
 */

const POI_CATEGORIES = {
  school:      { type: 'school',           keyword: 'school'       },
  hospital:    { type: 'hospital',          keyword: 'hospital'     },
  metro:       { type: 'transit_station',   keyword: 'metro station'},
  mall:        { type: 'shopping_mall',     keyword: 'mall'         },
  park:        { type: 'park',              keyword: 'park'         },
  bank:        { type: 'bank',              keyword: 'bank atm'     },
  restaurant:  { type: 'restaurant',        keyword: 'restaurant'   },
  supermarket: { type: 'supermarket',       keyword: 'supermarket'  },
  gym:         { type: 'gym',               keyword: 'gym'          },
  pharmacy:    { type: 'pharmacy',          keyword: 'pharmacy'     },
};

const CACHE_TTL_DAYS = 7;
const RADIUS_METERS  = 2000;

/**
 * Get POIs for a listing. Returns cached data if fresh, fetches from Google if stale.
 */
async function getPOIs(listingId) {
  // Check cache freshness
  const cacheRes = await pool.query(
    `SELECT category, COUNT(*) AS count, MAX(fetched_at) AS latest
     FROM neighbourhood_pois WHERE listing_id=$1
     GROUP BY category`,
    [listingId]
  );

  const cacheAge = cacheRes.rows.length
    ? (Date.now() - new Date(cacheRes.rows[0]?.latest).getTime()) / 86400000
    : Infinity;

  // Return cached if fresh
  if (cacheAge < CACHE_TTL_DAYS && cacheRes.rows.length >= 3) {
    const pois = await pool.query(
      `SELECT * FROM neighbourhood_pois WHERE listing_id=$1 ORDER BY category, distance_m`,
      [listingId]
    );
    return { pois: pois.rows, source: 'cache' };
  }

  // Fetch listing coordinates
  const listingRes = await pool.query(
    `SELECT lat, lng, city, locality FROM listings WHERE id=$1`, [listingId]
  );
  if (!listingRes.rows.length) throw new Error('Listing not found');
  const { lat, lng, city, locality } = listingRes.rows[0];

  if (!lat || !lng) {
    logger.warn(`[Neighbourhood] No coordinates for listing ${listingId}`);
    // Return cached even if stale
    const pois = await pool.query(`SELECT * FROM neighbourhood_pois WHERE listing_id=$1 ORDER BY category, distance_m`, [listingId]);
    return { pois: pois.rows, source: 'cache_stale' };
  }

  // Fetch from Google Places API
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    logger.warn('[Neighbourhood] GOOGLE_PLACES_API_KEY not set — returning existing cache');
    const pois = await pool.query(`SELECT * FROM neighbourhood_pois WHERE listing_id=$1 ORDER BY category, distance_m`, [listingId]);
    return { pois: pois.rows, source: 'cache_no_key' };
  }

  const fetchedPOIs = [];
  for (const [category, config] of Object.entries(POI_CATEGORIES)) {
    try {
      const places = await fetchNearbyPlaces(lat, lng, config.type, config.keyword);
      for (const place of places.slice(0, 3)) {
        const distanceM = Math.round(haversine(parseFloat(lat), parseFloat(lng), place.geometry.location.lat, place.geometry.location.lng));
        fetchedPOIs.push({
          listing_id: listingId, name: place.name, category,
          address: place.vicinity, distance_m: distanceM,
          rating: place.rating || null,
          google_place_id: place.place_id,
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
        });
      }
    } catch (err) {
      logger.warn(`[Neighbourhood] Failed to fetch ${category}: ${err.message}`);
    }
  }

  if (fetchedPOIs.length > 0) {
    // Replace cache: delete old, insert new
    await pool.query('DELETE FROM neighbourhood_pois WHERE listing_id=$1', [listingId]);
    for (const poi of fetchedPOIs) {
      await pool.query(
        `INSERT INTO neighbourhood_pois (listing_id, name, category, address, distance_m, rating, google_place_id, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [poi.listing_id, poi.name, poi.category, poi.address, poi.distance_m, poi.rating, poi.google_place_id, poi.lat, poi.lng]
      );
    }
  }

  return { pois: fetchedPOIs, source: 'google_places' };
}

async function fetchNearbyPlaces(lat, lng, type, keyword) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', String(RADIUS_METERS));
  url.searchParams.set('type', type);
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('key', process.env.GOOGLE_PLACES_API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Places API HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') throw new Error(`Places API: ${data.status}`);
  return data.results || [];
}

/**
 * Group POIs by category for display
 */
async function getPOIsSummary(listingId) {
  const { pois } = await getPOIs(listingId);
  const grouped = {};
  for (const poi of pois) {
    if (!grouped[poi.category]) grouped[poi.category] = [];
    grouped[poi.category].push(poi);
  }
  // Sort each category by distance
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort((a, b) => (a.distance_m || 9999) - (b.distance_m || 9999));
  }
  return grouped;
}

/**
 * Compute a "livability score" 0–100 based on POI coverage
 */
async function getLivabilityScore(listingId) {
  const { pois } = await getPOIs(listingId);
  const categoryWeights = {
    school: 20, hospital: 20, metro: 15, mall: 10,
    park: 10, bank: 5, restaurant: 5, supermarket: 10, gym: 5,
  };
  let score = 0;
  const coverage = new Set(pois.map((p) => p.category));
  for (const [cat, weight] of Object.entries(categoryWeights)) {
    if (coverage.has(cat)) {
      const closest = pois.filter((p) => p.category === cat).sort((a, b) => a.distance_m - b.distance_m)[0];
      const distanceFactor = closest?.distance_m < 500 ? 1 : closest?.distance_m < 1000 ? 0.8 : 0.6;
      score += weight * distanceFactor;
    }
  }
  return Math.round(Math.min(score, 100));
}

/** Haversine formula: distance in metres between two lat/lng points */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { getPOIs, getPOIsSummary, getLivabilityScore };
