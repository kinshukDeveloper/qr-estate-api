const { pool } = require('../config/database');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

// ── F16: NRI PORTAL ───────────────────────────────────────────────────────────

/** Country → timezone mapping for popular NRI destinations */
const NRI_COUNTRIES = [
  { country: 'United States',    code: 'US', timezone: 'America/New_York',     flag: '🇺🇸', offset: '-4:00 to -10:00' },
  { country: 'United Kingdom',   code: 'GB', timezone: 'Europe/London',        flag: '🇬🇧', offset: '+1:00' },
  { country: 'UAE',              code: 'AE', timezone: 'Asia/Dubai',           flag: '🇦🇪', offset: '+4:00' },
  { country: 'Canada',           code: 'CA', timezone: 'America/Toronto',      flag: '🇨🇦', offset: '-4:00 to -7:00' },
  { country: 'Australia',        code: 'AU', timezone: 'Australia/Sydney',     flag: '🇦🇺', offset: '+10:00 to +11:00' },
  { country: 'Singapore',        code: 'SG', timezone: 'Asia/Singapore',       flag: '🇸🇬', offset: '+8:00' },
  { country: 'Germany',          code: 'DE', timezone: 'Europe/Berlin',        flag: '🇩🇪', offset: '+2:00' },
  { country: 'New Zealand',      code: 'NZ', timezone: 'Pacific/Auckland',     flag: '🇳🇿', offset: '+12:00 to +13:00' },
  { country: 'Bahrain',          code: 'BH', timezone: 'Asia/Bahrain',         flag: '🇧🇭', offset: '+3:00' },
  { country: 'Kuwait',           code: 'KW', timezone: 'Asia/Kuwait',          flag: '🇰🇼', offset: '+3:00' },
  { country: 'Qatar',            code: 'QA', timezone: 'Asia/Qatar',           flag: '🇶🇦', offset: '+3:00' },
  { country: 'Malaysia',         code: 'MY', timezone: 'Asia/Kuala_Lumpur',    flag: '🇲🇾', offset: '+8:00' },
];

async function submitNRICallback({ listingId, agentId, name, email, phone, country, timezone, preferredTime, message }) {
  const res = await pool.query(
    `INSERT INTO nri_callbacks (listing_id, agent_id, name, email, phone, country, timezone, preferred_time, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [listingId || null, agentId || null, name, email, phone || null, country, timezone, preferredTime || null, message || null]
  );

  // Notify agent
  if (agentId && process.env.SMTP_USER) {
    const agentRes = await pool.query(`SELECT email, name FROM users WHERE id=$1`, [agentId]);
    if (agentRes.rows.length) {
      const mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await mailer.sendMail({
        from: `"QR Estate" <${process.env.SMTP_USER}>`,
        to: agentRes.rows[0].email,
        subject: `NRI Callback Request from ${name} (${country})`,
        html: `<div style="font-family:sans-serif;background:#07090D;color:#EEE8DC;padding:24px;border-radius:8px;border:1px solid #1B2330">
          <h2 style="color:#E8B84B">NRI Callback Request 🌍</h2>
          <p><b style="color:#fff">${name}</b> from <b style="color:#fff">${country}</b> wants a callback.</p>
          <table style="font-size:13px;color:#8899AA;width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#566070">Email</td><td style="color:#fff">${email}</td></tr>
            <tr><td style="padding:6px 0;color:#566070">Phone</td><td style="color:#fff">${phone || '—'}</td></tr>
            <tr><td style="padding:6px 0;color:#566070">Timezone</td><td style="color:#fff">${timezone}</td></tr>
            <tr><td style="padding:6px 0;color:#566070">Best time</td><td style="color:#fff">${preferredTime || 'Any time'}</td></tr>
            ${message ? `<tr><td style="padding:6px 0;color:#566070">Message</td><td style="color:#fff;font-style:italic">"${message}"</td></tr>` : ''}
          </table>
        </div>`,
      }).catch((e) => logger.warn(`[NRI] Email error: ${e.message}`));
    }
  }

  return { id: res.rows[0].id, message: 'Callback request submitted. The agent will contact you at your preferred time.' };
}

function getNRICountries() {
  return NRI_COUNTRIES;
}

/**
 * Convert price to foreign currencies (using free exchange rate API).
 * Falls back to hardcoded approximate rates if API unavailable.
 */
async function convertPrice(amountINR) {
  const FALLBACK_RATES = { USD: 0.012, GBP: 0.0094, EUR: 0.011, AED: 0.044, SGD: 0.016, AUD: 0.018, CAD: 0.016 };
  let rates = FALLBACK_RATES;

  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/INR');
    if (res.ok) {
      const data = await res.json();
      rates = { USD: data.rates.USD, GBP: data.rates.GBP, EUR: data.rates.EUR,
                AED: data.rates.AED, SGD: data.rates.SGD, AUD: data.rates.AUD, CAD: data.rates.CAD };
    }
  } catch { /* use fallback */ }

  const convert = (r) => Math.round(amountINR * r);
  return {
    INR: amountINR,
    USD: convert(rates.USD), GBP: convert(rates.GBP), EUR: convert(rates.EUR),
    AED: convert(rates.AED), SGD: convert(rates.SGD), AUD: convert(rates.AUD), CAD: convert(rates.CAD),
    source: rates === FALLBACK_RATES ? 'fallback' : 'live',
  };
}

// ── F17: HOME LOAN EMI CALCULATOR ─────────────────────────────────────────────

const BANK_RATES = [
  { bank: 'SBI',             logo: '🏦', min_rate: 8.50, max_rate: 9.65, max_tenure: 30, processing_fee: '0.35%' },
  { bank: 'HDFC',            logo: '🏦', min_rate: 8.70, max_rate: 9.75, max_tenure: 30, processing_fee: '0.50%' },
  { bank: 'ICICI Bank',      logo: '🏦', min_rate: 8.75, max_rate: 9.80, max_tenure: 30, processing_fee: '0.50%' },
  { bank: 'Axis Bank',       logo: '🏦', min_rate: 8.75, max_rate: 9.90, max_tenure: 30, processing_fee: '1.00%' },
  { bank: 'Kotak Mahindra',  logo: '🏦', min_rate: 8.75, max_rate: 9.85, max_tenure: 20, processing_fee: '0.50%' },
  { bank: 'PNB',             logo: '🏦', min_rate: 8.50, max_rate: 9.60, max_tenure: 30, processing_fee: '0.35%' },
  { bank: 'Bank of Baroda',  logo: '🏦', min_rate: 8.40, max_rate: 9.50, max_tenure: 30, processing_fee: '0.25%' },
  { bank: 'LIC HFL',         logo: '🏦', min_rate: 8.50, max_rate: 9.75, max_tenure: 30, processing_fee: '0.25%' },
  { bank: 'Bajaj Housing',   logo: '🏦', min_rate: 8.50, max_rate: 9.70, max_tenure: 32, processing_fee: '0.50%' },
];

function calculateEMI(principal, annualRate, tenureMonths) {
  const r = annualRate / 100 / 12;
  if (r === 0) return Math.round(principal / tenureMonths);
  const emi = principal * r * Math.pow(1 + r, tenureMonths) / (Math.pow(1 + r, tenureMonths) - 1);
  return Math.round(emi);
}

function calculateLoan({ propertyPrice, downPaymentPct = 20, annualRate = 8.7, tenureYears = 20 }) {
  const loanAmount = propertyPrice * (1 - downPaymentPct / 100);
  const downPayment = propertyPrice * (downPaymentPct / 100);
  const tenureMonths = tenureYears * 12;
  const emi = calculateEMI(loanAmount, annualRate, tenureMonths);
  const totalPayment = emi * tenureMonths;
  const totalInterest = totalPayment - loanAmount;
  const eligibleIncome = emi * (100 / 40); // assume 40% of income for EMI

  const bankComparison = BANK_RATES.map((bank) => ({
    ...bank,
    emi_min: calculateEMI(loanAmount, bank.min_rate, tenureMonths),
    emi_max: calculateEMI(loanAmount, bank.max_rate, tenureMonths),
    total_cost_min: calculateEMI(loanAmount, bank.min_rate, tenureMonths) * tenureMonths,
  })).sort((a, b) => a.emi_min - b.emi_min);

  return {
    property_price: propertyPrice,
    down_payment: Math.round(downPayment),
    loan_amount: Math.round(loanAmount),
    annual_rate: annualRate,
    tenure_years: tenureYears,
    tenure_months: tenureMonths,
    monthly_emi: emi,
    total_payment: Math.round(totalPayment),
    total_interest: Math.round(totalInterest),
    interest_to_principal_ratio: ((totalInterest / loanAmount) * 100).toFixed(1),
    min_monthly_income_required: Math.round(eligibleIncome),
    bank_comparison: bankComparison,
  };
}

function getBankRates() { return BANK_RATES; }

// ── F18: FEATURED LISTINGS ────────────────────────────────────────────────────

const BOOST_TIERS = {
  basic:   { label: 'Basic',   price_per_week: 9900,  price_display: '₹99/week',   duration_days: 7,  color: '#8899AA' },
  premium: { label: 'Premium', price_per_week: 24900, price_display: '₹249/week',  duration_days: 7,  color: '#00D4C8' },
  top:     { label: 'Top',     price_per_week: 49900, price_display: '₹499/week',  duration_days: 7,  color: '#E8B84B' },
};

async function boostListing(listingId, agentId, tier, paymentId) {
  if (!BOOST_TIERS[tier]) throw new Error('Invalid boost tier');
  const t = BOOST_TIERS[tier];
  const startsAt = new Date();
  const endsAt = new Date(Date.now() + t.duration_days * 86400000);

  const res = await pool.query(
    `INSERT INTO featured_listings (listing_id, agent_id, boost_tier, price_paid, starts_at, ends_at, payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (listing_id) DO UPDATE SET
       boost_tier=EXCLUDED.boost_tier, price_paid=EXCLUDED.price_paid,
       starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at,
       is_active=true, payment_id=EXCLUDED.payment_id
     RETURNING *`,
    [listingId, agentId, tier, t.price_per_week, startsAt, endsAt, paymentId || null]
  );
  return res.rows[0];
}

async function getFeaturedListings(limit = 10) {
  const res = await pool.query(
    `SELECT l.*, fl.boost_tier, fl.ends_at AS boost_ends,
            u.name AS agent_name, u.rera_number AS agent_rera,
            (SELECT COUNT(*) FROM saved_listings sl WHERE sl.listing_id=l.id) AS save_count
     FROM featured_listings fl
     JOIN listings l ON l.id=fl.listing_id
     JOIN users u ON u.id=l.agent_id
     WHERE fl.is_active=true AND fl.ends_at > now() AND l.status='active'
     ORDER BY CASE fl.boost_tier WHEN 'top' THEN 1 WHEN 'premium' THEN 2 ELSE 3 END, fl.starts_at DESC
     LIMIT $1`,
    [limit]
  );
  // Track impression
  if (res.rows.length) {
    pool.query(
      `UPDATE featured_listings SET impressions=impressions+1 WHERE listing_id=ANY($1::uuid[]) AND is_active=true`,
      [res.rows.map((r) => r.id)]
    ).catch(() => {});
  }
  return res.rows;
}

// ── F18: AGENT REVIEWS ────────────────────────────────────────────────────────

async function submitReview({ agentId, listingId, reviewerName, reviewerEmail, rating, title, body }) {
  if (rating < 1 || rating > 5) throw new Error('Rating must be 1–5');
  const res = await pool.query(
    `INSERT INTO agent_reviews (agent_id, listing_id, reviewer_name, reviewer_email, rating, title, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [agentId, listingId || null, reviewerName, reviewerEmail || null, rating, title || null, body || null]
  );
  return res.rows[0];
}

async function getAgentReviews(agentId, { page = 1, limit = 10 } = {}) {
  const offset = (page - 1) * limit;
  const [reviews, stats] = await Promise.all([
    pool.query(
      `SELECT * FROM agent_reviews WHERE agent_id=$1 AND is_visible=true ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    ),
    pool.query(
      `SELECT
          ROUND(AVG(rating)::numeric,1) AS avg_rating,
          COUNT(*) AS total,
          SUM(CASE WHEN rating=5 THEN 1 ELSE 0 END) AS five_star,
          SUM(CASE WHEN rating=4 THEN 1 ELSE 0 END) AS four_star,
          SUM(CASE WHEN rating=3 THEN 1 ELSE 0 END) AS three_star,
          SUM(CASE WHEN rating<=2 THEN 1 ELSE 0 END) AS low_star
       FROM agent_reviews WHERE agent_id=$1 AND is_visible=true`,
      [agentId]
    ),
  ]);
  return { reviews: reviews.rows, stats: stats.rows[0] };
}

async function replyToReview(reviewId, agentId, reply) {
  const res = await pool.query(
    `UPDATE agent_reviews SET agent_reply=$1 WHERE id=$2 AND agent_id=$3 RETURNING id`,
    [reply, reviewId, agentId]
  );
  if (!res.rows.length) throw new Error('Review not found or forbidden');
  return { updated: true };
}

module.exports = {
  // F16
  submitNRICallback, getNRICountries, convertPrice,
  // F17
  calculateLoan, getBankRates,
  // F18
  boostListing, getFeaturedListings, BOOST_TIERS,
  submitReview, getAgentReviews, replyToReview,
};
