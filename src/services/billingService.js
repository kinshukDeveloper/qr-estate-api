const crypto = require('crypto');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// ── PLAN DEFINITIONS ──────────────────────────────────────────────────────────
const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    listing_limit: 5,
    qr_limit: 5,
    brochure: false,
    analytics: false,
    whatsapp_leads: false,
    features: ['5 listings', '5 QR codes', 'Basic property page'],
  },
  pro: {
    name: 'Pro',
    price: 49900, // ₹499 in paise
    listing_limit: -1, // unlimited
    qr_limit: -1,
    brochure: true,
    analytics: true,
    whatsapp_leads: true,
    features: ['Unlimited listings', 'Unlimited QR codes', 'PDF brochures', 'Analytics dashboard', 'WhatsApp lead alerts', 'Priority support'],
  },
  agency: {
    name: 'Agency',
    price: 499900, // ₹4999 in paise
    listing_limit: -1,
    qr_limit: -1,
    brochure: true,
    analytics: true,
    whatsapp_leads: true,
    multi_agent: true,
    features: ['Everything in Pro', 'Multi-agent team', 'Custom domain QR', 'Bulk operations', 'Dedicated support'],
  },
};

// ── GET USER PLAN ─────────────────────────────────────────────────────────────
async function getUserPlan(userId) {
  const result = await query(
    'SELECT plan, plan_expires_at, subscription_status FROM users WHERE id = $1',
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw createError('User not found', 404);

  // Check if plan is expired
  const isExpired = user.plan !== 'free' &&
    user.plan_expires_at &&
    new Date(user.plan_expires_at) < new Date();

  const effectivePlan = isExpired ? 'free' : user.plan;
  return {
    plan: effectivePlan,
    plan_expires_at: user.plan_expires_at,
    subscription_status: user.subscription_status,
    is_expired: isExpired,
    limits: PLANS[effectivePlan],
  };
}

// ── CHECK PLAN LIMIT ──────────────────────────────────────────────────────────
async function checkListingLimit(userId) {
  const { plan, limits } = await getUserPlan(userId);
  if (limits.listing_limit === -1) return { allowed: true, plan };

  const countResult = await query(
    "SELECT COUNT(*) FROM listings WHERE agent_id = $1 AND status != 'inactive'",
    [userId]
  );
  const count = parseInt(countResult.rows[0].count);

  if (count >= limits.listing_limit) {
    throw createError(
      `Your ${plan} plan allows ${limits.listing_limit} listings. Upgrade to Pro for unlimited listings.`,
      403
    );
  }
  return { allowed: true, plan, current: count, limit: limits.listing_limit };
}

// ── CREATE RAZORPAY ORDER ─────────────────────────────────────────────────────
async function createOrder(userId, planKey) {
  if (!PLANS[planKey] || planKey === 'free') {
    throw createError('Invalid plan selected', 400);
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw createError('Payment gateway not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env', 503);
  }

  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const plan = PLANS[planKey];
  const order = await razorpay.orders.create({
    amount: plan.price,
    currency: 'INR',
    receipt: `qre_${userId.slice(0, 8)}_${Date.now()}`,
    notes: { user_id: userId, plan: planKey },
  });

  // Save pending payment
  await query(
    `INSERT INTO payments (user_id, razorpay_order_id, plan, amount, status)
     VALUES ($1,$2,$3,$4,'pending')`,
    [userId, order.id, planKey, plan.price]
  );

  return {
    order_id: order.id,
    amount: plan.price,
    currency: 'INR',
    plan: planKey,
    plan_name: plan.name,
    key_id: process.env.RAZORPAY_KEY_ID,
  };
}

// ── VERIFY PAYMENT & ACTIVATE PLAN ───────────────────────────────────────────
async function verifyPayment(userId, { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan }) {
  // Verify signature
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    throw createError('Payment verification failed — invalid signature', 400);
  }

  // Set plan expiry (1 year from now)
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  // Upgrade user plan
  await query(
    `UPDATE users SET
       plan = $1,
       plan_expires_at = $2,
       subscription_status = 'active',
       updated_at = NOW()
     WHERE id = $3`,
    [plan, expiresAt.toISOString(), userId]
  );

  // Update payment record
  await query(
    `UPDATE payments SET
       razorpay_payment_id = $1,
       razorpay_signature = $2,
       status = 'success'
     WHERE razorpay_order_id = $3`,
    [razorpay_payment_id, razorpay_signature, razorpay_order_id]
  );

  logger.info(`Plan upgraded to ${plan} for user ${userId}`);

  return {
    success: true,
    plan,
    plan_expires_at: expiresAt,
    message: `Successfully upgraded to ${PLANS[plan].name} plan`,
  };
}

// ── GET PAYMENT HISTORY ───────────────────────────────────────────────────────
async function getPaymentHistory(userId) {
  const result = await query(
    `SELECT id, plan, amount, currency, status, razorpay_payment_id, created_at
     FROM payments WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

// ── DOWNGRADE TO FREE ─────────────────────────────────────────────────────────
async function cancelSubscription(userId) {
  await query(
    `UPDATE users SET
       plan = 'free',
       plan_expires_at = NULL,
       subscription_status = 'cancelled',
       updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
  return { message: 'Subscription cancelled. Downgraded to Free plan.' };
}

module.exports = {
  PLANS,
  getUserPlan,
  checkListingLimit,
  createOrder,
  verifyPayment,
  getPaymentHistory,
  cancelSubscription,
};
