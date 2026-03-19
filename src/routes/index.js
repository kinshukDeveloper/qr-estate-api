const express = require('express');
const router = express.Router();

// ── ROUTE MODULES ─────────────────────────────────────────────────────────────
// Feature 1: Auth
const authRoutes = require('./auth');

// Feature 2: Listings
const listingRoutes = require('./listings');

// Feature 3: QR Codes
const qrRoutes = require('./qr');

// Feature 4: Public property page
const publicRoutes = require('./public');

// Feature 5: Analytics
const analyticsRoutes = require('./analytics');

// Feature 6: Leads
const leadRoutes = require('./leads');

// Feature 7: Brochure
const brochureRoutes = require('./brochure');
router.use('/brochure', brochureRoutes);

// Feature 8: Health Monitor
const healthRoutes = require('./health');
router.use('/health', healthRoutes);

// ── MOUNT ROUTES ──────────────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/listings', listingRoutes);
router.use('/qr', qrRoutes);
router.use('/p', publicRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/leads', leadRoutes);
// Feature 9: Billing
const billingRoutes = require('./billing');
router.use('/billing', billingRoutes);

// ── API STATUS ────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'QR Estate API',
    version: process.env.API_VERSION || 'v1',
    docs: `${process.env.APP_URL}/api/docs`,
    endpoints: {
      auth: '/api/v1/auth',
      listings: '/api/v1/listings (coming soon)',
      qr: '/api/v1/qr (coming soon)',
    },
  });
});

module.exports = router;
