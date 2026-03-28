const documentService     = require('../services/documentService');
const marketService       = require('../services/marketService');
const neighbourhoodService = require('../services/neighbourhoodService');
const avmService          = require('../services/avmService');
const multer              = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(null, ok);
  },
});

// ── F09: DOCUMENT VAULT ───────────────────────────────────────────────────────
exports.uploadDocument = [
  upload.single('document'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'File required (PDF/JPG/PNG, max 20MB)' });
      const { docType, label, isPublic } = req.body;
      if (!docType || !label) return res.status(400).json({ success: false, message: 'docType and label are required' });
      const doc = await documentService.uploadDocument(
        req.params.listingId, req.user.id,
        req.file.buffer, req.file.mimetype,
        { docType, label, isPublic: isPublic === 'true' }
      );
      res.status(201).json({ success: true, data: doc });
    } catch (err) {
      if (['Listing not found or forbidden', 'Only PDF, JPG, PNG, WEBP allowed'].includes(err.message))
        return res.status(400).json({ success: false, message: err.message });
      next(err);
    }
  },
];

exports.getDocuments = async (req, res, next) => {
  try {
    const agentId = req.user?.id || null;
    const docs = await documentService.getDocuments(req.params.listingId, agentId);
    res.json({ success: true, data: { documents: docs } });
  } catch (err) { next(err); }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const result = await documentService.deleteDocument(req.params.docId, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ success: false, message: err.message });
    next(err);
  }
};

exports.requestAccess = async (req, res, next) => {
  try {
    const { buyerName, buyerEmail, buyerPhone, message } = req.body;
    if (!buyerName || !buyerEmail) return res.status(400).json({ success: false, message: 'buyerName and buyerEmail required' });
    const result = await documentService.requestAccess(req.params.docId, { buyerName, buyerEmail, buyerPhone, message });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.message.includes('publicly accessible')) return res.status(400).json({ success: false, message: err.message });
    next(err);
  }
};

exports.getRequests = async (req, res, next) => {
  try {
    const requests = await documentService.getRequests(req.params.listingId, req.user.id);
    res.json({ success: true, data: { requests } });
  } catch (err) { next(err); }
};

exports.approveRequest = async (req, res, next) => {
  try {
    const result = await documentService.approveRequest(req.params.requestId, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ success: false, message: err.message });
    next(err);
  }
};

exports.rejectRequest = async (req, res, next) => {
  try {
    const result = await documentService.rejectRequest(req.params.requestId, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

exports.secureDownload = async (req, res, next) => {
  try {
    const { url, label } = await documentService.getSecureDownload(req.params.token);
    res.redirect(url);
  } catch (err) {
    if (err.message.includes('expired') || err.message.includes('Invalid'))
      return res.status(410).json({ success: false, message: err.message });
    next(err);
  }
};

// ── F10: MARKET INTELLIGENCE ──────────────────────────────────────────────────
exports.marketSnapshot = async (req, res, next) => {
  try {
    if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET)
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await marketService.takeSnapshot();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

exports.getPriceTrend = async (req, res, next) => {
  try {
    const { city, propertyType, listingType, days, locality } = req.query;
    if (!city) return res.status(400).json({ success: false, message: 'city is required' });
    const data = await marketService.getPriceTrend({ city, propertyType, listingType, days: parseInt(days || '90'), locality });
    res.json({ success: true, data: { trend: data } });
  } catch (err) { next(err); }
};

exports.getHeatmap = async (req, res, next) => {
  try {
    const { city, propertyType, listingType } = req.query;
    if (!city) return res.status(400).json({ success: false, message: 'city is required' });
    const data = await marketService.getHeatmap({ city, propertyType, listingType });
    res.json({ success: true, data: { heatmap: data } });
  } catch (err) { next(err); }
};

exports.getCitySummary = async (req, res, next) => {
  try {
    const data = await marketService.getCitySummary(req.params.city);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

exports.getCities = async (req, res, next) => {
  try {
    const cities = await marketService.getAvailableCities();
    res.json({ success: true, data: { cities } });
  } catch (err) { next(err); }
};

exports.getSupplyDemand = async (req, res, next) => {
  try {
    const { city, days } = req.query;
    if (!city) return res.status(400).json({ success: false, message: 'city required' });
    const data = await marketService.getSupplyDemand({ city, days });
    res.json({ success: true, data: { supply_demand: data } });
  } catch (err) { next(err); }
};

// ── F11: NEIGHBOURHOOD ────────────────────────────────────────────────────────
exports.getNeighbourhood = async (req, res, next) => {
  try {
    const summary = await neighbourhoodService.getPOIsSummary(req.params.listingId);
    const score   = await neighbourhoodService.getLivabilityScore(req.params.listingId);
    res.json({ success: true, data: { pois: summary, livability_score: score } });
  } catch (err) { next(err); }
};

// ── F12: AVM ──────────────────────────────────────────────────────────────────
exports.runValuation = async (req, res, next) => {
  try {
    const { listingId, city, locality, propertyType, areaSqft, bedrooms, inputPrice } = req.body;
    if (!listingId && (!city || !propertyType))
      return res.status(400).json({ success: false, message: 'Provide listingId OR (city + propertyType)' });
    const result = await avmService.runValuation({
      listingId, city, locality, propertyType,
      areaSqft: areaSqft ? parseInt(areaSqft) : undefined,
      bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
      inputPrice: inputPrice ? parseFloat(inputPrice) : undefined,
      requestedBy: req.user?.id || null,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

exports.getLatestValuation = async (req, res, next) => {
  try {
    const report = await avmService.getLatestReport(req.params.listingId);
    res.json({ success: true, data: { report } });
  } catch (err) { next(err); }
};

exports.getAgentValuations = async (req, res, next) => {
  try {
    const reports = await avmService.getAgentReports(req.user.id);
    res.json({ success: true, data: { reports } });
  } catch (err) { next(err); }
};
