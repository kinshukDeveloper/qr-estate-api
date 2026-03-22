'use strict';
/**
 * portalService.js — Feature 7: Portal API
 *
 * Provides:
 *  - API key generation / listing / revocation
 *  - JWT-style key validation for portal requests
 *  - Webhook CRUD + HMAC-SHA256 signed delivery
 *  - Public read-only listing API (for MagicBricks / 99acres style portals)
 */

const crypto       = require('crypto');
const { query }    = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const logger       = require('../config/logger');

const KEY_PREFIX   = 'qre_live_';
const MAX_KEYS     = 10;   // per agent
const MAX_WEBHOOKS = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex'); }
function hmac256(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
function randomKey() {
  return KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
}
function randomSecret() { return crypto.randomBytes(32).toString('hex'); }

// ── API Keys ──────────────────────────────────────────────────────────────────

const VALID_SCOPES = ['listings:read', 'leads:read', 'analytics:read', 'qr:read'];

async function createApiKey(agentId, { name, scopes = ['listings:read'], expiresInDays }) {
  if (!name?.trim()) throw createError('API key name is required', 400);

  // Validate scopes
  const badScopes = (scopes || []).filter(s => !VALID_SCOPES.includes(s));
  if (badScopes.length) throw createError(`Invalid scopes: ${badScopes.join(', ')}`, 400);

  // Cap per-agent
  const countRes = await query(
    'SELECT COUNT(*) FROM api_keys WHERE agent_id=$1 AND is_active=true', [agentId]
  );
  if (parseInt(countRes.rows[0].count) >= MAX_KEYS) {
    throw createError(`Maximum ${MAX_KEYS} active API keys allowed`, 400);
  }

  const rawKey   = randomKey();
  const keyHash  = sha256(rawKey);
  const preview  = rawKey.slice(0, 12) + '...' + rawKey.slice(-6);
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString()
    : null;

  const res = await query(
    `INSERT INTO api_keys (agent_id, name, key_prefix, key_hash, key_preview, scopes, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, key_preview, scopes, expires_at, created_at`,
    [agentId, name.trim(), KEY_PREFIX, keyHash, preview, scopes, expiresAt]
  );

  return { ...res.rows[0], key: rawKey };  // key returned ONCE only
}

async function listApiKeys(agentId) {
  const res = await query(
    `SELECT id, name, key_preview, scopes, rate_limit,
            is_active, last_used_at, usage_count, expires_at, created_at
     FROM api_keys WHERE agent_id=$1 ORDER BY created_at DESC`,
    [agentId]
  );
  return res.rows;
}

async function revokeApiKey(agentId, keyId) {
  const res = await query(
    `UPDATE api_keys SET is_active=false, updated_at=NOW()
     WHERE id=$1 AND agent_id=$2 RETURNING id`,
    [keyId, agentId]
  );
  if (!res.rows[0]) throw createError('API key not found', 404);
  return { revoked: true };
}

// Validate an incoming API key from Authorization header
async function validateApiKey(rawKey) {
  if (!rawKey?.startsWith(KEY_PREFIX)) return null;
  const hash = sha256(rawKey);
  const res  = await query(
    `SELECT k.*, u.id AS agent_id_real, u.name AS agent_name
     FROM api_keys k JOIN users u ON u.id = k.agent_id
     WHERE k.key_hash=$1 AND k.is_active=true
       AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
    [hash]
  );
  const key = res.rows[0];
  if (!key) return null;

  // Update usage stats (fire-and-forget)
  query('UPDATE api_keys SET last_used_at=NOW(), usage_count=usage_count+1 WHERE id=$1', [key.id])
    .catch(() => {});

  return key;
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

const VALID_EVENTS = [
  'listing.created', 'listing.updated', 'listing.deleted', 'listing.sold',
  'lead.created', 'lead.updated',
  'qr.scanned',
  'callback.missed', 'callback.connected',
];

async function createWebhook(agentId, { name, url, events }) {
  if (!name?.trim()) throw createError('Webhook name is required', 400);
  if (!url?.startsWith('https://')) throw createError('Webhook URL must use HTTPS', 400);
  if (!events?.length) throw createError('At least one event type is required', 400);

  const bad = events.filter(e => !VALID_EVENTS.includes(e));
  if (bad.length) throw createError(`Invalid events: ${bad.join(', ')}`, 400);

  const countRes = await query(
    'SELECT COUNT(*) FROM webhooks WHERE agent_id=$1 AND is_active=true', [agentId]
  );
  if (parseInt(countRes.rows[0].count) >= MAX_WEBHOOKS) {
    throw createError(`Maximum ${MAX_WEBHOOKS} webhooks allowed`, 400);
  }

  const secret = randomSecret();
  const res    = await query(
    `INSERT INTO webhooks (agent_id, name, url, secret, events)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name, url, events, is_active, created_at`,
    [agentId, name.trim(), url, secret, events]
  );

  return { ...res.rows[0], secret };  // secret returned ONCE
}

async function listWebhooks(agentId) {
  const res = await query(
    `SELECT id, name, url, events, is_active,
            last_triggered_at, success_count, fail_count, created_at
     FROM webhooks WHERE agent_id=$1 ORDER BY created_at DESC`,
    [agentId]
  );
  return res.rows;
}

async function deleteWebhook(agentId, webhookId) {
  const res = await query(
    'DELETE FROM webhooks WHERE id=$1 AND agent_id=$2 RETURNING id',
    [webhookId, agentId]
  );
  if (!res.rows[0]) throw createError('Webhook not found', 404);
  return { deleted: true };
}

async function getWebhookDeliveries(agentId, webhookId) {
  // Verify ownership
  const own = await query('SELECT id FROM webhooks WHERE id=$1 AND agent_id=$2', [webhookId, agentId]);
  if (!own.rows[0]) throw createError('Webhook not found', 404);

  const res = await query(
    `SELECT event_type, response_status, success, delivered_at
     FROM webhook_deliveries WHERE webhook_id=$1
     ORDER BY delivered_at DESC LIMIT 50`,
    [webhookId]
  );
  return res.rows;
}

// ── Webhook dispatch (called from event hooks in services) ────────────────────
async function dispatchEvent(agentId, eventType, payload) {
  if (!agentId || !eventType) return;

  // Find all active webhooks for this agent that subscribe to this event
  const res = await query(
    `SELECT id, url, secret FROM webhooks
     WHERE agent_id=$1 AND is_active=true AND $2=ANY(events)`,
    [agentId, eventType]
  );
  if (!res.rows.length) return;

  const body = JSON.stringify({
    event:     eventType,
    timestamp: new Date().toISOString(),
    data:      payload,
  });

  // Fire all deliveries concurrently (non-blocking)
  const deliveries = res.rows.map(async (wh) => {
    const sig = hmac256(wh.secret, body);
    let success = false;
    let status  = null;
    let resBody = null;

    try {
      const response = await fetch(wh.url, {
        method:  'POST',
        headers: {
          'Content-Type':       'application/json',
          'X-QRE-Signature':    `sha256=${sig}`,
          'X-QRE-Event':        eventType,
          'User-Agent':         'QREstateWebhooks/1.0',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status  = response.status;
      resBody = await response.text().catch(() => '');
      success = response.ok;
    } catch (err) {
      resBody = err.message;
    }

    // Log delivery
    await query(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, response_status, response_body, success)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [wh.id, eventType, JSON.parse(body), status, resBody?.substring(0, 500), success]
    );

    // Update counters
    await query(
      `UPDATE webhooks SET
         last_triggered_at=NOW(),
         success_count = success_count + $1,
         fail_count    = fail_count    + $2
       WHERE id=$3`,
      [success ? 1 : 0, success ? 0 : 1, wh.id]
    );

    if (!success) logger.warn(`Webhook delivery failed: ${wh.url} → ${status}`);
  });

  Promise.allSettled(deliveries);  // fire-and-forget, never throw
}

// ── Public Portal API listings ─────────────────────────────────────────────────
async function getPortalListings({ agencyId, city, property_type, listing_type,
  min_price, max_price, page = 1, limit = 20, bedrooms }) {
  limit  = Math.min(parseInt(limit), 50);
  const offset = (parseInt(page) - 1) * limit;

  const conditions = ["l.status = 'active'"];
  const vals = [];
  let i = 1;

  if (agencyId)      { conditions.push(`l.agency_id=$${i++}`);      vals.push(agencyId); }
  if (city)          { conditions.push(`LOWER(l.city)=LOWER($${i++})`); vals.push(city); }
  if (property_type) { conditions.push(`l.property_type=$${i++}`);  vals.push(property_type); }
  if (listing_type)  { conditions.push(`l.listing_type=$${i++}`);   vals.push(listing_type); }
  if (min_price)     { conditions.push(`l.price>=$${i++}`);         vals.push(min_price); }
  if (max_price)     { conditions.push(`l.price<=$${i++}`);         vals.push(max_price); }
  if (bedrooms)      { conditions.push(`l.bedrooms=$${i++}`);       vals.push(bedrooms); }

  const WHERE = `WHERE ${conditions.join(' AND ')}`;

  const [countRes, dataRes] = await Promise.all([
    query(`SELECT COUNT(*) FROM listings l ${WHERE}`, vals),
    query(
      `SELECT l.id, l.title, l.property_type, l.listing_type, l.price, l.price_negotiable,
              l.bedrooms, l.bathrooms, l.area_sqft, l.floor_number, l.total_floors,
              l.furnishing, l.facing, l.locality, l.city, l.state, l.pincode,
              l.amenities, l.short_code, l.view_count, l.quality_score,
              l.images->0 AS primary_image,
              u.name AS agent_name, u.rera_number AS agent_rera
       FROM listings l JOIN users u ON u.id = l.agent_id
       ${WHERE}
       ORDER BY l.quality_score DESC, l.created_at DESC
       LIMIT $${i} OFFSET $${i+1}`,
      [...vals, limit, offset]
    ),
  ]);

  return {
    listings: dataRes.rows.map(l => ({
      ...l,
      portal_url: `${process.env.FRONTEND_URL}/p/${l.short_code}`,
    })),
    pagination: {
      total: parseInt(countRes.rows[0].count),
      page:  parseInt(page),
      limit,
      pages: Math.ceil(parseInt(countRes.rows[0].count) / limit),
    },
  };
}

module.exports = {
  createApiKey, listApiKeys, revokeApiKey, validateApiKey,
  createWebhook, listWebhooks, deleteWebhook, getWebhookDeliveries,
  dispatchEvent,
  getPortalListings,
  VALID_SCOPES, VALID_EVENTS,
};
