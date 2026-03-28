const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// ── CREATE LEAD ───────────────────────────────────────────────────────────────
async function createLead(agentId, data) {
  const {
    listing_id, name, phone, email, message,
    source = 'manual', status = 'new', notes, follow_up_date, budget,
  } = data;

  if (!phone) throw createError('Phone number is required', 400);

  // Check for duplicate (same phone + listing in last 24h)
  if (listing_id) {
    const dup = await query(
      `SELECT id FROM leads
       WHERE agent_id = $1 AND listing_id = $2 AND phone = $3
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [agentId, listing_id, phone]
    );
    if (dup.rows.length > 0) {
      throw createError('A lead from this number for this listing already exists in the last 24 hours', 409);
    }
  }

  const result = await query(
    `INSERT INTO leads (
       agent_id, listing_id, name, phone, email, message,
       source, status, notes, follow_up_date, budget
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      agentId, listing_id || null, name || null, phone, email || null,
      message || null, source, status, notes || null,
      follow_up_date || null, budget || null,
    ]
  );
  dispatch(lead.agent_id || result.rows[0]?.agent_id, 'lead.created', { lead_id: result.rows[0]?.id, listing_id: result.rows[0]?.listing_id, source: result.rows[0]?.source });

  const lead = result.rows[0];

  // Fetch listing info for notification
  if (listing_id) {
    const listingRes = await query(
      'SELECT title, city, price FROM listings WHERE id = $1',
      [listing_id]
    );
    lead.listing = listingRes.rows[0] || null;
  }

  // Send WhatsApp notification to agent (fire and forget)
  sendWhatsAppNotification(agentId, lead).catch(err =>
    logger.warn('WhatsApp notification failed:', err.message)
  );

  return lead;
}

// ── GET ALL LEADS ─────────────────────────────────────────────────────────────
async function getLeads(agentId, filters = {}) {
  const {
    page = 1, limit = 20, status, source, listing_id, search,
  } = filters;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = ['l.agent_id = $1'];
  const values = [agentId];
  let p = 2;

  if (status) { conditions.push(`l.status = $${p}`); values.push(status); p++; }
  if (source) { conditions.push(`l.source = $${p}`); values.push(source); p++; }
  if (listing_id) { conditions.push(`l.listing_id = $${p}`); values.push(listing_id); p++; }
  if (search) {
    conditions.push(`(l.name ILIKE $${p} OR l.phone ILIKE $${p} OR l.email ILIKE $${p})`);
    values.push(`%${search}%`); p++;
  }

  const WHERE = `WHERE ${conditions.join(' AND ')}`;

  const countRes = await query(`SELECT COUNT(*) FROM leads l ${WHERE}`, values);
  const total = parseInt(countRes.rows[0].count);

  values.push(parseInt(limit), offset);
  const result = await query(
    `SELECT l.*,
            li.title as listing_title, li.city as listing_city,
            li.price as listing_price, li.property_type, li.listing_type
     FROM leads l
     LEFT JOIN listings li ON li.id = l.listing_id
     ${WHERE}
     ORDER BY
       CASE l.status WHEN 'new' THEN 0 WHEN 'interested' THEN 1 WHEN 'contacted' THEN 2 ELSE 3 END,
       l.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    values
  );

  return {
    leads: result.rows,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / parseInt(limit)),
      has_next: offset + result.rows.length < total,
      has_prev: parseInt(page) > 1,
    },
  };
}

// ── GET ONE LEAD ──────────────────────────────────────────────────────────────
async function getLead(leadId, agentId) {
  const result = await query(
    `SELECT l.*,
            li.title as listing_title, li.city as listing_city,
            li.price as listing_price, li.property_type, li.short_code
     FROM leads l
     LEFT JOIN listings li ON li.id = l.listing_id
     WHERE l.id = $1 AND l.agent_id = $2`,
    [leadId, agentId]
  );
  if (!result.rows[0]) throw createError('Lead not found', 404);
  return result.rows[0];
}

// ── UPDATE LEAD ───────────────────────────────────────────────────────────────
async function updateLead(leadId, agentId, data) {
  await getLead(leadId, agentId);

  const allowed = ['name', 'phone', 'email', 'message', 'status', 'notes', 'follow_up_date', 'budget'];
  const updates = [];
  const values = [];
  let p = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (allowed.includes(key) && value !== undefined) {
      updates.push(`${key} = $${p}`);
      values.push(value);
      p++;
    }
  });

  if (!updates.length) throw createError('No valid fields to update', 400);

  values.push(leadId);
  const result = await query(
    `UPDATE leads SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${p} RETURNING *`,
    values
  );
  return result.rows[0];
}

// ── DELETE LEAD ───────────────────────────────────────────────────────────────
async function deleteLead(leadId, agentId) {
  await getLead(leadId, agentId);
  await query('DELETE FROM leads WHERE id = $1', [leadId]);
  return { id: leadId };
}

// ── GET LEAD STATS ────────────────────────────────────────────────────────────
async function getLeadStats(agentId) {
  const result = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'new') as new_leads,
       COUNT(*) FILTER (WHERE status = 'interested') as interested,
       COUNT(*) FILTER (WHERE status = 'converted') as converted,
       COUNT(*) FILTER (WHERE status = 'not_interested' OR status = 'lost') as lost,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as this_week,
       COUNT(*) FILTER (WHERE follow_up_date::date = CURRENT_DATE) as follow_up_today
     FROM leads WHERE agent_id = $1`,
    [agentId]
  );
  return result.rows[0];
}

// ── WHATSAPP NOTIFICATION (Twilio) ────────────────────────────────────────────
async function sendWhatsAppNotification(agentId, lead) {
  // Only send if Twilio is configured
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    logger.info('Twilio not configured — skipping WhatsApp notification');
    return;
  }

  try {
    const agentRes = await query('SELECT name, phone FROM users WHERE id = $1', [agentId]);
    const agent = agentRes.rows[0];
    if (!agent?.phone) return;

    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const listingInfo = lead.listing
      ? `\n🏠 Property: ${lead.listing.title}\n📍 ${lead.listing.city}`
      : '';

    const message = `🔔 *New Lead — QR Estate*\n\n👤 Name: ${lead.name || 'Unknown'}\n📱 Phone: ${lead.phone}${lead.email ? `\n📧 ${lead.email}` : ''}${listingInfo}${lead.message ? `\n\n💬 "${lead.message}"` : ''}\n\nReply to this message to respond to the lead.`;

    await twilio.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to: `whatsapp:+91${agent.phone.replace(/\D/g, '')}`,
      body: message,
    });

    logger.info(`WhatsApp notification sent to agent ${agent.name}`);
  } catch (err) {
    logger.warn('WhatsApp send failed:', err.message);
  }
}

// ── PUBLIC: Capture lead from property page ───────────────────────────────────
async function capturePublicLead(shortCode, data) {
  // Find the listing + agent by short_code
  const listingRes = await query(
    'SELECT id, agent_id FROM listings WHERE short_code = $1',
    [shortCode]
  );
  const listing = listingRes.rows[0];
  if (!listing) throw createError('Listing not found', 404);

  return createLead(listing.agent_id, {
    ...data,
    listing_id: listing.id,
    source: 'whatsapp',
  });
}

module.exports = {
  createLead, getLeads, getLead, updateLead,
  deleteLead, getLeadStats, capturePublicLead,
};
