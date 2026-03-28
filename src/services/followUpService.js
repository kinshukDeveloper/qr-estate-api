const { pool } = require('../config/database');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

/**
 * F08 — Automated Follow-up Sequences Service
 *
 * Sequence per new lead:
 *   Step 1: T+0    → WhatsApp message (immediate)
 *   Step 2: T+24h  → Email with PDF brochure link
 *   Step 3: T+72h  → WhatsApp price analysis nudge
 *   Step 4: T+7d   → Email check-in
 *
 * Cron job runs every 15 min, sends due items.
 */

const TEMPLATES = {
  step1_whatsapp: (lead, listing) =>
    `Hi ${lead.name || 'there'}! 👋 Thank you for your interest in *${listing?.title || 'our property'}*. ` +
    `I'm ${lead.agent_name}, your dedicated agent. ` +
    `The property is currently listed at *${formatPrice(listing?.price)}*. ` +
    `Would you like to schedule a site visit? Reply here or call me anytime.`,

  step2_email_subject: (listing) =>
    `Property Details & Brochure — ${listing?.title || 'Your Enquiry'}`,

  step2_email_html: (lead, listing, brochureUrl) => `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#07090D;color:#EEE8DC;border:1px solid #1B2330;border-radius:8px;overflow:hidden">
      <div style="background:#0C0F14;padding:20px 24px;border-bottom:1px solid #1B2330">
        <span style="font-weight:800;font-size:16px;color:#E8B84B">QR Estate</span>
      </div>
      <div style="padding:24px">
        <h2 style="color:#fff;margin:0 0 8px">Hi ${lead.name || 'there'} 👋</h2>
        <p style="color:#8899AA;line-height:1.6">Thanks for your interest in <strong style="color:#fff">${listing?.title}</strong>.</p>
        <div style="background:#0C0F14;border:1px solid #1B2330;border-radius:6px;padding:16px;margin:16px 0">
          <div style="font-size:22px;font-weight:800;color:#E8B84B">${formatPrice(listing?.price)}</div>
          <div style="color:#8899AA;font-size:12px;margin-top:4px">${listing?.city} · ${listing?.property_type}</div>
        </div>
        ${brochureUrl ? `<a href="${brochureUrl}" style="display:inline-block;background:#E8B84B;color:#000;font-weight:700;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:10px">Download Brochure →</a>` : ''}
        <a href="${process.env.FRONTEND_URL}/p/${listing?.short_code}" style="display:inline-block;background:transparent;color:#E8B84B;font-weight:700;padding:10px 20px;border-radius:6px;text-decoration:none;border:1px solid #E8B84B">View Online →</a>
      </div>
    </div>`,

  step3_whatsapp: (lead, listing) =>
    `Hi ${lead.name || 'there'} 👋 Just wanted to share — properties in *${listing?.locality || listing?.city}* ` +
    `have seen strong demand this season. *${listing?.title}* at ${formatPrice(listing?.price)} is competitively priced. ` +
    `Would you like me to arrange a visit this week?`,

  step4_email_subject: () => `Still interested? We'd love to help you find your dream property`,

  step4_email_html: (lead, listing) => `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#07090D;color:#EEE8DC;border:1px solid #1B2330;border-radius:8px;overflow:hidden">
      <div style="background:#0C0F14;padding:20px 24px;border-bottom:1px solid #1B2330">
        <span style="font-weight:800;font-size:16px;color:#E8B84B">QR Estate</span>
      </div>
      <div style="padding:24px">
        <h2 style="color:#fff;margin:0 0 8px">Hi ${lead.name || 'there'}</h2>
        <p style="color:#8899AA;line-height:1.6">
          It's been a week since you enquired about <strong style="color:#fff">${listing?.title}</strong>. 
          Are you still looking? I'd love to help — even if this specific property isn't the right fit, 
          I may have other options matching your requirements.
        </p>
        <p style="color:#8899AA;line-height:1.6">Feel free to reply to this email or WhatsApp me directly.</p>
        <a href="${process.env.FRONTEND_URL}/p/${listing?.short_code}" style="display:inline-block;background:#E8B84B;color:#000;font-weight:700;padding:10px 20px;border-radius:6px;text-decoration:none">View Property Again →</a>
      </div>
    </div>`,
};

function formatPrice(p) {
  if (!p) return '—';
  if (p >= 10000000) return `₹${(p / 10000000).toFixed(1)}Cr`;
  if (p >= 100000)   return `₹${(p / 100000).toFixed(1)}L`;
  return `₹${Number(p).toLocaleString('en-IN')}`;
}

function getMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

/**
 * Schedule the 4-step sequence for a newly captured lead.
 * Call this from leadService when a new lead is created.
 */
async function scheduleSequence(leadId, agentId) {
  const now = new Date();
  const steps = [
    { step: 1, channel: 'whatsapp', template_key: 'step1_whatsapp',  delay_ms: 0 },
    { step: 2, channel: 'email',    template_key: 'step2_email',      delay_ms: 24 * 3600 * 1000 },
    { step: 3, channel: 'whatsapp', template_key: 'step3_whatsapp',   delay_ms: 72 * 3600 * 1000 },
    { step: 4, channel: 'email',    template_key: 'step4_email',      delay_ms: 7 * 24 * 3600 * 1000 },
  ];

  const values = steps.map((s) =>
    `('${leadId}','${agentId}',${s.step},'${s.channel}','${s.template_key}','${new Date(now.getTime() + s.delay_ms).toISOString()}')`
  ).join(',');

  await pool.query(
    `INSERT INTO follow_up_sequences (lead_id, agent_id, step, channel, template_key, scheduled_at)
     VALUES ${values}
     ON CONFLICT DO NOTHING`
  );
}

/**
 * Cron: send all due follow-ups. Call every 15 minutes.
 */
async function processDueFollowUps() {
  const res = await pool.query(
    `SELECT
        fus.*,
        l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email,
        u.name AS agent_name, u.phone AS agent_phone, u.email AS agent_email,
        li.title AS listing_title, li.price AS listing_price,
        li.city AS listing_city, li.locality AS listing_locality,
        li.property_type, li.short_code, li.images AS listing_images
     FROM follow_up_sequences fus
     JOIN leads l ON l.id = fus.lead_id
     JOIN users u ON u.id = fus.agent_id
     LEFT JOIN listings li ON li.id = l.listing_id
     WHERE fus.status = 'scheduled'
       AND fus.scheduled_at <= now()
     ORDER BY fus.scheduled_at
     LIMIT 50`
  );

  let sent = 0, failed = 0;

  for (const item of res.rows) {
    try {
      await sendFollowUp(item);
      await pool.query(
        `UPDATE follow_up_sequences SET status='sent', sent_at=now() WHERE id=$1`, [item.id]
      );
      sent++;
    } catch (err) {
      logger.error(`[FollowUp] Failed step ${item.step} for lead ${item.lead_id}: ${err.message}`);
      await pool.query(
        `UPDATE follow_up_sequences SET status='failed', error_msg=$1 WHERE id=$2`,
        [err.message, item.id]
      );
      failed++;
    }
  }

  return { sent, failed, total: res.rows.length };
}

async function sendFollowUp(item) {
  const lead = { name: item.lead_name, phone: item.lead_phone, email: item.lead_email, agent_name: item.agent_name };
  const listing = {
    title: item.listing_title, price: item.listing_price,
    city: item.listing_city, locality: item.listing_locality,
    property_type: item.property_type, short_code: item.short_code,
  };

  if (item.channel === 'whatsapp') {
    // WhatsApp via link (deep link — agent must click to send, or use WhatsApp Cloud API)
    const message = item.template_key === 'step1_whatsapp'
      ? TEMPLATES.step1_whatsapp(lead, listing)
      : TEMPLATES.step3_whatsapp(lead, listing);

    // If WhatsApp Business API configured, send directly
    if (process.env.WHATSAPP_API_TOKEN && item.lead_phone) {
      await sendWhatsAppMessage(item.lead_phone, message);
    } else {
      // Fallback: log the message for agent to send manually
      logger.info(`[FollowUp] WhatsApp (manual): To ${item.lead_phone}\n${message}`);
    }
  } else if (item.channel === 'email' && item.lead_email) {
    if (!process.env.SMTP_USER) return;
    const mailer = getMailer();
    const isStep2 = item.template_key === 'step2_email';
    await mailer.sendMail({
      from: `"${item.agent_name} via QR Estate" <${process.env.SMTP_USER}>`,
      to: item.lead_email,
      subject: isStep2
        ? TEMPLATES.step2_email_subject(listing)
        : TEMPLATES.step4_email_subject(),
      html: isStep2
        ? TEMPLATES.step2_email_html(lead, listing, null)
        : TEMPLATES.step4_email_html(lead, listing),
    });
  }
}

async function sendWhatsAppMessage(phone, message) {
  // WhatsApp Cloud API (Meta)
  const cleaned = phone.replace(/\D/g, '');
  const to = cleaned.startsWith('91') ? cleaned : `91${cleaned}`;

  await fetch(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    }
  );
}

/** Pause/resume all sequences for a lead */
async function toggleSequence(leadId, agentId, pause = true) {
  const status = pause ? 'paused' : 'scheduled';
  await pool.query(
    `UPDATE follow_up_sequences SET status=$1
     WHERE lead_id=$2 AND agent_id=$3 AND status IN ('scheduled','paused')`,
    [status, leadId, agentId]
  );
  return { paused: pause };
}

/** Get sequence status for a lead */
async function getSequence(leadId, agentId) {
  const res = await pool.query(
    `SELECT * FROM follow_up_sequences
     WHERE lead_id=$1 AND agent_id=$2 ORDER BY step`,
    [leadId, agentId]
  );
  return res.rows;
}

module.exports = { scheduleSequence, processDueFollowUps, toggleSequence, getSequence };
