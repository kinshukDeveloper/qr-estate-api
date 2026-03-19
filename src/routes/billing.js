const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');
const billingService = require('../services/billingService');

router.use(authenticate);

// GET /api/v1/billing/plans — get all plan details
router.get('/plans', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { plans: billingService.PLANS } });
}));

// GET /api/v1/billing/me — current plan + status
router.get('/me', asyncHandler(async (req, res) => {
  const planData = await billingService.getUserPlan(req.user.id);
  res.json({ success: true, data: planData });
}));

// POST /api/v1/billing/order — create Razorpay order
router.post('/order', asyncHandler(async (req, res) => {
  const { plan } = req.body;
  const order = await billingService.createOrder(req.user.id, plan);
  res.status(201).json({ success: true, data: order });
}));

// POST /api/v1/billing/verify — verify payment + activate plan
router.post('/verify', asyncHandler(async (req, res) => {
  const result = await billingService.verifyPayment(req.user.id, req.body);
  res.json({ success: true, data: result });
}));

// GET /api/v1/billing/history — payment history
router.get('/history', asyncHandler(async (req, res) => {
  const payments = await billingService.getPaymentHistory(req.user.id);
  res.json({ success: true, data: { payments } });
}));

// DELETE /api/v1/billing/cancel — cancel subscription
router.delete('/cancel', asyncHandler(async (req, res) => {
  const result = await billingService.cancelSubscription(req.user.id);
  res.json({ success: true, data: result });
}));

module.exports = router;
