const leadScoringService  = require('../services/leadScoringService');
const photoAdvisorService = require('../services/photoAdvisorService');
const aiChatService       = require('../services/aiChatService');
const svc                 = require('../services/buyerServicesF16F18');

// ── F13: LEAD SCORING ─────────────────────────────────────────────────────────
exports.getLeadScores = async (req, res, next) => {
  try {
    const { grade, page, limit } = req.query;
    const data = await leadScoringService.getLeadScores(req.user.id, { grade, page: parseInt(page||1), limit: parseInt(limit||20) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

exports.getScoreSummary = async (req, res, next) => {
  try {
    const data = await leadScoringService.getScoreSummary(req.user.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

exports.scoreOneLead = async (req, res, next) => {
  try {
    const result = await leadScoringService.scoreLeadById(req.params.leadId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

exports.scoreAllLeads = async (req, res, next) => {
  try {
    if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET)
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await leadScoringService.scoreAllLeads();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

// ── F14: PHOTO ADVISOR ────────────────────────────────────────────────────────
exports.analysePhotos = async (req, res, next) => {
  try {
    const force = req.query.force === 'true';
    const result = await photoAdvisorService.analyseListingPhotos(req.params.listingId, req.user.id, force);
    res.json({ success: true, data: result });
  } catch (err) {
    if (['Forbidden', 'Listing not found'].includes(err.message))
      return res.status(err.message === 'Forbidden' ? 403 : 404).json({ success: false, message: err.message });
    next(err);
  }
};

// ── F15: AI CHAT ──────────────────────────────────────────────────────────────
exports.chat = async (req, res, next) => {
  try {
    const { message } = req.body;
    const sessionToken = req.headers['x-session-token'] || req.body.sessionToken;
    if (!message?.trim()) return res.status(400).json({ success: false, message: 'message is required' });
    if (!sessionToken) return res.status(400).json({ success: false, message: 'x-session-token header required' });
    const result = await aiChatService.chat(req.params.listingId, sessionToken, message);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

exports.getChatHistory = async (req, res, next) => {
  try {
    const sessionToken = req.headers['x-session-token'] || req.query.session;
    if (!sessionToken) return res.json({ success: true, data: { messages: [] } });
    const data = await aiChatService.getHistory(req.params.listingId, sessionToken);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

exports.captureChatLead = async (req, res, next) => {
  try {
    const { sessionId, name, phone, email } = req.body;
    if (!sessionId || !name || !phone) return res.status(400).json({ success: false, message: 'sessionId, name, phone required' });
    const result = await aiChatService.captureLeadFromChat(sessionId, { name, phone, email });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

// ── F16: NRI ──────────────────────────────────────────────────────────────────
exports.getNRICountries = (req, res) => res.json({ success: true, data: { countries: svc.getNRICountries() } });

exports.convertPrice = async (req, res, next) => {
  try {
    const { amount } = req.query;
    if (!amount) return res.status(400).json({ success: false, message: 'amount is required' });
    const result = await svc.convertPrice(parseFloat(amount));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

exports.submitNRICallback = async (req, res, next) => {
  try {
    const { listingId, name, email, phone, country, timezone, preferredTime, message } = req.body;
    if (!name || !email || !country || !timezone) return res.status(400).json({ success: false, message: 'name, email, country, timezone required' });
    const listingRes = listingId
      ? await require('../config/database').pool.query(`SELECT agent_id FROM listings WHERE id=$1`, [listingId])
      : { rows: [] };
    const agentId = listingRes.rows[0]?.agent_id || null;
    const result = await svc.submitNRICallback({ listingId, agentId, name, email, phone, country, timezone, preferredTime, message });
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
};

// ── F17: EMI ──────────────────────────────────────────────────────────────────
exports.calculateEMI = (req, res, next) => {
  try {
    const { propertyPrice, downPaymentPct, annualRate, tenureYears } = req.query;
    if (!propertyPrice) return res.status(400).json({ success: false, message: 'propertyPrice required' });
    const result = svc.calculateLoan({
      propertyPrice: parseFloat(propertyPrice),
      downPaymentPct: downPaymentPct ? parseFloat(downPaymentPct) : 20,
      annualRate: annualRate ? parseFloat(annualRate) : 8.7,
      tenureYears: tenureYears ? parseInt(tenureYears) : 20,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

exports.getBankRates = (req, res) => res.json({ success: true, data: { banks: svc.getBankRates() } });

// ── F18: FEATURED ─────────────────────────────────────────────────────────────
exports.getFeatured = async (req, res, next) => {
  try {
    const listings = await svc.getFeaturedListings(parseInt(req.query.limit || '10'));
    res.json({ success: true, data: { listings } });
  } catch (err) { next(err); }
};

exports.boostListing = async (req, res, next) => {
  try {
    const { tier, paymentId } = req.body;
    if (!tier) return res.status(400).json({ success: false, message: 'tier required (basic|premium|top)' });
    const result = await svc.boostListing(req.params.listingId, req.user.id, tier, paymentId);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Invalid boost tier') return res.status(400).json({ success: false, message: err.message });
    next(err);
  }
};

exports.getBoostTiers = (req, res) => res.json({ success: true, data: { tiers: svc.BOOST_TIERS } });

// ── F18: REVIEWS ──────────────────────────────────────────────────────────────
exports.submitReview = async (req, res, next) => {
  try {
    const { agentId, listingId, reviewerName, reviewerEmail, rating, title, body } = req.body;
    if (!agentId || !reviewerName || !rating) return res.status(400).json({ success: false, message: 'agentId, reviewerName, rating required' });
    const review = await svc.submitReview({ agentId, listingId, reviewerName, reviewerEmail, rating: parseInt(rating), title, body });
    res.status(201).json({ success: true, data: review });
  } catch (err) {
    if (err.message === 'Rating must be 1–5') return res.status(400).json({ success: false, message: err.message });
    next(err);
  }
};

exports.getAgentReviews = async (req, res, next) => {
  try {
    const data = await svc.getAgentReviews(req.params.agentId, { page: parseInt(req.query.page||1), limit: parseInt(req.query.limit||10) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

exports.replyToReview = async (req, res, next) => {
  try {
    const { reply } = req.body;
    if (!reply) return res.status(400).json({ success: false, message: 'reply is required' });
    const result = await svc.replyToReview(req.params.reviewId, req.user.id, reply);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message.includes('forbidden')) return res.status(403).json({ success: false, message: err.message });
    next(err);
  }
};
