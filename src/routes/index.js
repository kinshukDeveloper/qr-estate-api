const express = require('express');
const router = express.Router();

const authRoutes      = require('./auth');
const listingRoutes   = require('./listings');
const qrRoutes        = require('./qr');
const publicRoutes    = require('./public');
const analyticsRoutes = require('./analytics');
const leadRoutes      = require('./leads');
const brochureRoutes  = require('./brochure');
const healthRoutes    = require('./health');
const billingRoutes   = require('./billing');
const agencyRoutes    = require('./agencies');
const aiRoutes        = require('./ai');
const callbackRoutes  = require('./callbacks');   // F4
const tourRoutes      = require('./tours');        // F5
const brandRoutes     = require('./brand');        // F6
const portalRoutes    = require('./portal');       // F7
const optimizerRoutes = require('./optimizer');    // F8
const builderRoutes   = require('./builder');      // F9
const buyerRoutes     = require('./buyer');
const v3Routes        = require('./features');     // V3 product features

router.use('/auth',      authRoutes);
router.use('/listings',  listingRoutes);
router.use('/qr',        qrRoutes);
router.use('/p',         publicRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/leads',     leadRoutes);
router.use('/brochure',  brochureRoutes);
router.use('/health',    healthRoutes);
router.use('/billing',   billingRoutes);
router.use('/agencies',  agencyRoutes);
router.use('/ai',        aiRoutes);
router.use('/callbacks', callbackRoutes);
router.use('/tours',     tourRoutes);
router.use('/brand',     brandRoutes);
router.use('/portal',    portalRoutes);
router.use('/optimizer', optimizerRoutes);
router.use('/builder',   builderRoutes);
router.use('/buyer',     buyerRoutes);
router.use('/v3',        v3Routes);               // V3 product features

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'QR Estate API v2',
    version: process.env.API_VERSION || 'v1',
    features: {
      f1: 'Agency Workspace',
      f2: 'AI Conversion Intelligence',
      f3: 'Regional Languages',
      f4: '60-Second Callback',
      f5: 'Virtual Tour Embed',
      f6: 'White-label Platform',
      f7: 'Portal API',
      f8: 'AI Optimizer',
      f9: 'Builder Suite',
    },
  });
});

module.exports = router;