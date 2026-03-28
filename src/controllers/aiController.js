const aiService = require('../services/aiService');
const { createError } = require('../middleware/errorHandler');

// GET /api/v1/ai/score/:listingId
async function getScore(req, res) {
  const qs = await aiService.getQualityScore(req.params.listingId, req.user.id);
  res.json({ success: true, data: qs });
}

// POST /api/v1/ai/tips/:listingId
async function getTips(req, res) {
  const result = await aiService.getListingTips(req.params.listingId, req.user.id);
  res.json({ success: true, data: result });
}

// POST /api/v1/ai/write-description/:listingId
async function writeDescription(req, res) {
  const result = await aiService.writeDescription(req.params.listingId, req.user.id);
  res.json({ success: true, data: result });
}

// POST /api/v1/ai/photo-check/:listingId
async function checkPhotos(req, res) {
  const result = await aiService.checkPhotos(req.params.listingId, req.user.id);
  res.json({ success: true, data: result });
}

// DELETE /api/v1/ai/cache/:listingId  — force-refresh cache
async function clearCache(req, res) {
  await aiService.invalidateCache(req.params.listingId);
  res.json({ success: true, message: 'AI cache cleared. Next request will regenerate.' });
}

module.exports = { getScore, getTips, writeDescription, checkPhotos, clearCache };
