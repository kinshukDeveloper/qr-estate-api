'use strict';

/**
 * callbackService.js — Feature 4: 60-second callback
 *
 * Flow:
 *   1. Buyer submits phone on property page
 *   2. We call the AGENT first (Twilio Voice)
 *   3. When agent picks up → Twilio TwiML connects buyer
 *   4. If agent misses → WhatsApp notification to agent
 *   5. Dashboard shows missed callback count + SLA report
 *
 * Works without Twilio: stores the request and returns a
 * WhatsApp deep-link the buyer can use manually.
 */

const { query, getClient } = require('../config/database');
const { createError }      = require('../middleware/errorHandler');
const logger               = require('../config/logger');

// ── Twilio lazy loader ─────────────────────────────────────────────────────
let twilioClient = null;
function getTwilio() {
  if (twilioClient) return twilioClient;
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    logger.warn('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — callback runs without voice calls');
    return null;
  }
  try {
    twilioClient = require('twilio')(sid, token);
    return twilioClient;
  } catch {
    logger.warn('twilio package not installed');
    return null;
  }
}

// ── Valid callback statuses ──────────────────────────────────────────────────
const STATUSES = ['pending','calling','connected','missed','failed'];

// ── Request callback ──────────────────────────────────────────────────────────
async function requestCallback(listingId, buyerPhone) {
  // Validate listing + get agent phone
  const listRes = await query(
    `SELECT l.id, l.title, l.short_code,
            l.agent_id,
            u.name  AS agent_name,
            u.phone AS agent_phone
     FROM listings l
     JOIN users u ON u.id = l.agent_id
     WHERE l.id = $1 AND l.status = 'active'`,
    [listingId]
  );
  const listing = listRes.rows[0];
  if (!listing) throw createError('Listing not found or inactive', 404);

  // Sanitise buyer phone: strip non-digits, ensure 10 digits
  const cleaned = buyerPhone.replace(/\D/g, '').replace(/^91/, '');
  if (cleaned.length !== 10) throw createError('Enter a valid 10-digit Indian mobile number', 400);

  // Rate-limit: max 1 pending/calling request per buyer+listing per hour
  const recentCheck = await query(
    `SELECT id FROM callback_requests
     WHERE listing_id = $1 AND buyer_phone = $2
       AND status IN ('pending','calling')
       AND requested_at > NOW() - INTERVAL '1 hour'`,
    [listingId, cleaned]
  );
  if (recentCheck.rows.length > 0) {
    throw createError('A callback request already exists for this listing. Please wait 1 hour.', 429);
  }

  // Create request record
  const cbRes = await query(
    `INSERT INTO callback_requests
       (listing_id, agent_id, buyer_phone, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id`,
    [listingId, listing.agent_id, cleaned]
  );
  const cbId = cbRes.rows[0].id;

  const agentPhoneE164 = `+91${listing.agent_phone?.replace(/\D/g, '').replace(/^91/, '') || ''}`;
  const buyerPhoneE164 = `+91${cleaned}`;

  let callSid   = null;
  let callMade  = false;
  const twilio  = getTwilio();

  // ── Attempt Twilio Voice call ─────────────────────────────────────────────
  if (twilio && listing.agent_phone) {
    try {
      // TwiML: when agent picks up, bridge to buyer
      const twimlUrl = `${process.env.APP_URL}/api/v1/callbacks/twiml/${cbId}?buyer=${encodeURIComponent(buyerPhoneE164)}`;

      const call = await twilio.calls.create({
        to:  agentPhoneE164,
        from: process.env.TWILIO_PHONE_FROM || process.env.TWILIO_SMS_FROM,
        url: twimlUrl,
        statusCallback: `${process.env.APP_URL}/api/v1/callbacks/status/${cbId}`,
        statusCallbackMethod: 'POST',
        timeout: 60,
      });

      callSid  = call.sid;
      callMade = true;

      await query(
        'UPDATE callback_requests SET status = $1, call_sid = $2 WHERE id = $3',
        ['calling', callSid, cbId]
      );
      logger.info(`Callback call initiated: ${callSid} for request ${cbId}`);
    } catch (err) {
      logger.warn('Twilio call failed, falling back to WhatsApp:', err.message);
    }
  }

  // ── WhatsApp notification to agent (always, not just on fallback) ─────────
  if (twilio && listing.agent_phone) {
    try {
      const propertyUrl = `${process.env.FRONTEND_URL}/p/${listing.short_code}`;
      const waMsg = callMade
        ? `📞 *Incoming buyer call!*\n\nA buyer at *${listing.title}* requested a callback.\nBuyer: +91 ${cleaned}\n\nPick up your phone now — the call is connecting.\n\n${propertyUrl}`
        : `📞 *Callback request!*\n\nA buyer wants you to call them about *${listing.title}*.\nBuyer phone: *+91 ${cleaned}*\n\nCall them back within 60 seconds for best conversion.\n\n${propertyUrl}`;

      await twilio.messages.create({
        body: waMsg,
        from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
        to:   `whatsapp:${agentPhoneE164}`,
      });
    } catch (err) {
      logger.warn('WhatsApp notification failed:', err.message);
    }
  }

  // Build WhatsApp deep-link for buyer (fallback if no Twilio)
  const waFallback = listing.agent_phone
    ? `https://wa.me/91${listing.agent_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, I requested a callback for ${listing.title}. My number is +91 ${cleaned}`)}`
    : null;

  return {
    request_id:    cbId,
    call_initiated: callMade,
    agent_notified: true,
    whatsapp_fallback: waFallback,
    message: callMade
      ? 'Your call is being connected. The agent will call you within 60 seconds.'
      : 'Request sent. The agent has been notified via WhatsApp and will call you back shortly.',
  };
}

// ── TwiML webhook — bridges agent call to buyer ──────────────────────────────
function buildTwiml(buyerPhone) {
  // Returns TwiML XML that Twilio executes when agent picks up
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting you to a buyer who requested a callback.</Say>
  <Dial timeout="30" callerId="${process.env.TWILIO_PHONE_FROM || ''}">
    <Number>${buyerPhone}</Number>
  </Dial>
</Response>`;
}

// ── Twilio status callback ────────────────────────────────────────────────────
async function handleStatusCallback(cbId, callStatus) {
  const statusMap = {
    'completed': 'connected',
    'busy':      'missed',
    'no-answer': 'missed',
    'failed':    'failed',
    'canceled':  'missed',
  };

  const newStatus = statusMap[callStatus];
  if (!newStatus) return;

  await query(
    `UPDATE callback_requests
     SET status = $1,
         connected_at = CASE WHEN $1 = 'connected' THEN NOW() ELSE connected_at END,
         ended_at     = NOW()
     WHERE id = $2`,
    [newStatus, cbId]
  );

  // If missed, send WhatsApp alert to agent
  if (newStatus === 'missed') {
    const cbRes = await query(
      `SELECT cr.buyer_phone, cr.listing_id, l.title, l.short_code,
              u.phone AS agent_phone, u.name AS agent_name
       FROM callback_requests cr
       JOIN listings l ON l.id = cr.listing_id
       JOIN users u    ON u.id = cr.agent_id
       WHERE cr.id = $1`,
      [cbId]
    );
    const cb = cbRes.rows[0];
    if (cb) {
      const twilio = getTwilio();
      if (twilio && cb.agent_phone) {
        const propertyUrl = `${process.env.FRONTEND_URL}/p/${cb.short_code}`;
        try {
          await twilio.messages.create({
            body: `⚠️ *Missed callback!*\n\nYou missed a callback from a buyer interested in *${cb.title}*.\nBuyer: *+91 ${cb.buyer_phone}*\nCall them back now!\n\n${propertyUrl}`,
            from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
            to:   `whatsapp:+91${cb.agent_phone.replace(/\D/g, '')}`,
          });
        } catch (err) {
          logger.warn('Missed callback WA failed:', err.message);
        }
      }
    }
  }
}

// ── Get callback stats (for dashboard widget) ────────────────────────────────
async function getCallbackStats(agentId) {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'connected')::int AS connected,
       COUNT(*) FILTER (WHERE status = 'missed')::int    AS missed,
       COUNT(*) FILTER (WHERE status = 'pending' OR status = 'calling')::int AS pending,
       COUNT(*)::int                                      AS total,
       COUNT(*) FILTER (WHERE requested_at > NOW() - INTERVAL '24 hours' AND status = 'missed')::int AS missed_today,
       ROUND(
         AVG(EXTRACT(EPOCH FROM (connected_at - requested_at))) FILTER (WHERE status = 'connected')
       )::int AS avg_response_seconds
     FROM callback_requests
     WHERE agent_id = $1`,
    [agentId]
  );
  return result.rows[0];
}

// ── Get callback list (paginated) ────────────────────────────────────────────
async function getCallbacks(agentId, { page = 1, limit = 20, status } = {}) {
  const offset = (page - 1) * limit;
  const conds  = ['cr.agent_id = $1'];
  const vals   = [agentId];
  let i = 2;
  if (status) { conds.push(`cr.status = $${i++}`); vals.push(status); }

  const WHERE = `WHERE ${conds.join(' AND ')}`;
  const countRes = await query(`SELECT COUNT(*) FROM callback_requests cr ${WHERE}`, vals);
  vals.push(limit, offset);
  const dataRes  = await query(
    `SELECT cr.*, l.title, l.short_code, l.city
     FROM callback_requests cr
     JOIN listings l ON l.id = cr.listing_id
     ${WHERE}
     ORDER BY cr.requested_at DESC
     LIMIT $${i} OFFSET $${i+1}`,
    vals
  );
  return {
    callbacks:  dataRes.rows,
    pagination: { total: parseInt(countRes.rows[0].count), page, limit },
  };
}

module.exports = {
  requestCallback,
  buildTwiml,
  handleStatusCallback,
  getCallbackStats,
  getCallbacks,
};
