const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * F03 — Price Alert Service
 * Subscribe/unsubscribe for price drop alerts.
 * Cron job in jobs/priceAlertCron.js calls checkAndSendAlerts().
 */

// ── Mailer ────────────────────────────────────────────────────────────────────
function getMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ── Subscribe ─────────────────────────────────────────────────────────────────
async function subscribe(listingId, email) {
  // Get current price
  const listingRes = await pool.query(
    `SELECT id, title, price, city, images FROM listings WHERE id = $1 AND status = 'active'`,
    [listingId]
  );
  if (!listingRes.rows.length) throw new Error('Listing not found or not active');

  const listing = listingRes.rows[0];
  const unsubscribeToken = crypto.randomBytes(32).toString('hex');

  await pool.query(
    `INSERT INTO price_alerts (listing_id, email, price_at_signup, unsubscribe_token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (listing_id, email)
     DO UPDATE SET is_active = true, price_at_signup = EXCLUDED.price_at_signup`,
    [listingId, email, listing.price, unsubscribeToken]
  );

  // Send confirmation email
  await sendConfirmationEmail(email, listing);

  return { message: 'Subscribed. You\'ll be notified if the price drops.' };
}

// ── Unsubscribe ───────────────────────────────────────────────────────────────
async function unsubscribe(token) {
  const res = await pool.query(
    `UPDATE price_alerts SET is_active = false
     WHERE unsubscribe_token = $1
     RETURNING email, listing_id`,
    [token]
  );
  if (!res.rows.length) throw new Error('Invalid unsubscribe token');
  return { message: 'Unsubscribed successfully.' };
}

// ── Cron: Check & send alerts ─────────────────────────────────────────────────
/**
 * Called every 6 hours by the cron job.
 * For each active alert, check if current price < price_at_signup.
 * If yes, send alert email and update price_at_signup to new price.
 */
async function checkAndSendAlerts() {
  logger.info('[PriceAlert] Running price alert check...');

  const res = await pool.query(
    `SELECT
        pa.id,
        pa.email,
        pa.price_at_signup,
        pa.unsubscribe_token,
        l.id AS listing_id,
        l.title,
        l.price AS current_price,
        l.city,
        l.locality,
        l.short_code,
        l.images
     FROM price_alerts pa
     JOIN listings l ON l.id = pa.listing_id
     WHERE pa.is_active = true
       AND l.status = 'active'
       AND l.price < pa.price_at_signup
       AND (pa.last_notified_at IS NULL OR pa.last_notified_at < now() - interval '24 hours')`
  );

  if (!res.rows.length) {
    logger.info('[PriceAlert] No price drops to notify.');
    return { sent: 0 };
  }

  logger.info(`[PriceAlert] Sending ${res.rows.length} price drop notifications...`);
  let sent = 0;

  for (const alert of res.rows) {
    try {
      await sendPriceDropEmail(alert);
      // Update price_at_signup to current price so next alert only fires on further drop
      await pool.query(
        `UPDATE price_alerts
         SET last_notified_at = now(), price_at_signup = $1
         WHERE id = $2`,
        [alert.current_price, alert.id]
      );
      sent++;
    } catch (err) {
      logger.error(`[PriceAlert] Failed to send to ${alert.email}: ${err.message}`);
    }
  }

  logger.info(`[PriceAlert] Done. Sent: ${sent}/${res.rows.length}`);
  return { sent };
}

// ── Email Templates ───────────────────────────────────────────────────────────
function formatPrice(price) {
  const p = parseFloat(price);
  if (p >= 10000000) return `₹${(p / 10000000).toFixed(2)}Cr`;
  if (p >= 100000) return `₹${(p / 100000).toFixed(1)}L`;
  return `₹${p.toLocaleString('en-IN')}`;
}

async function sendConfirmationEmail(email, listing) {
  const mailer = getMailer();
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#07090D;color:#EEE8DC;border:1px solid #1B2330;border-radius:8px;overflow:hidden">
      <div style="background:#0C0F14;padding:20px 24px;border-bottom:1px solid #1B2330">
        <span style="font-weight:800;font-size:16px;color:#E8B84B">QR Estate</span>
      </div>
      <div style="padding:24px">
        <h2 style="margin:0 0 8px;font-size:18px;color:#fff">Price alert set! 🔔</h2>
        <p style="color:#8899AA;font-size:14px;line-height:1.6">
          You'll be notified by email if the price of <strong style="color:#fff">${listing.title}</strong> in ${listing.city} drops below <strong style="color:#E8B84B">${formatPrice(listing.price)}</strong>.
        </p>
        <div style="margin:20px 0;padding:16px;background:#0C0F14;border:1px solid #1B2330;border-radius:6px">
          <div style="font-size:13px;color:#8899AA">Current price</div>
          <div style="font-size:22px;font-weight:800;color:#E8B84B;margin-top:4px">${formatPrice(listing.price)}</div>
        </div>
        <a href="${process.env.FRONTEND_URL}/p/${listing.short_code}" 
           style="display:inline-block;background:#E8B84B;color:#000;font-weight:700;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px">
          View Listing →
        </a>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #1B2330;font-size:11px;color:#566070">
        You're receiving this because you signed up for price alerts on QR Estate.
      </div>
    </div>`;

  await mailer.sendMail({
    from: `"QR Estate" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Price alert set for ${listing.title}`,
    html,
  });
}

async function sendPriceDropEmail(alert) {
  const mailer = getMailer();
  const drop = alert.price_at_signup - alert.current_price;
  const dropPct = ((drop / alert.price_at_signup) * 100).toFixed(1);
  const frontendUrl = process.env.FRONTEND_URL || 'https://qrestate.in';

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#07090D;color:#EEE8DC;border:1px solid #1B2330;border-radius:8px;overflow:hidden">
      <div style="background:#0C0F14;padding:20px 24px;border-bottom:1px solid #1B2330">
        <span style="font-weight:800;font-size:16px;color:#E8B84B">QR Estate</span>
      </div>
      <div style="padding:24px">
        <div style="display:inline-block;background:rgba(40,216,144,0.1);border:1px solid rgba(40,216,144,0.2);color:#28D890;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:1px;margin-bottom:14px">
          PRICE DROP ↓ ${dropPct}%
        </div>
        <h2 style="margin:0 0 8px;font-size:18px;color:#fff">${alert.title}</h2>
        <p style="color:#8899AA;font-size:13px;margin:0 0 20px">${alert.locality ? alert.locality + ', ' : ''}${alert.city}</p>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
          <div style="padding:14px;background:#0C0F14;border:1px solid #1B2330;border-radius:6px">
            <div style="font-size:11px;color:#566070;margin-bottom:4px">WAS</div>
            <div style="font-size:16px;color:#8899AA;text-decoration:line-through">${formatPrice(alert.price_at_signup)}</div>
          </div>
          <div style="padding:14px;background:rgba(40,216,144,0.05);border:1px solid rgba(40,216,144,0.2);border-radius:6px">
            <div style="font-size:11px;color:#28D890;margin-bottom:4px">NOW</div>
            <div style="font-size:20px;font-weight:800;color:#28D890">${formatPrice(alert.current_price)}</div>
          </div>
        </div>

        <div style="margin-bottom:14px;padding:12px;background:rgba(232,184,75,0.05);border:1px solid rgba(232,184,75,0.15);border-radius:6px;font-size:13px;color:#D0C088">
          💰 You save <strong>${formatPrice(drop)}</strong> (${dropPct}% off original price)
        </div>

        <a href="${frontendUrl}/p/${alert.short_code}" 
           style="display:inline-block;background:#E8B84B;color:#000;font-weight:700;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-right:10px">
          View Listing →
        </a>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #1B2330;font-size:11px;color:#566070">
        <a href="${frontendUrl}/alerts/unsubscribe/${alert.unsubscribe_token}" style="color:#566070">Unsubscribe from price alerts</a>
      </div>
    </div>`;

  await mailer.sendMail({
    from: `"QR Estate" <${process.env.SMTP_USER}>`,
    to: alert.email,
    subject: `Price dropped ${dropPct}% — ${alert.title}`,
    html,
  });
}

module.exports = {
  subscribe,
  unsubscribe,
  checkAndSendAlerts,
};
