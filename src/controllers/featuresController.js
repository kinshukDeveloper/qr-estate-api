// ── controllers/featuresController.js ─────────────────────────────────────────
const videoService      = require('../services/videoService');
const eoiService        = require('../services/eoiService');
const commissionService = require('../services/commissionService');
const followUpService   = require('../services/followUpService');
const multer            = require('multer');

// Multer memory storage (we stream to Cloudinary directly)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/avi', 'video/x-msvideo'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── F05 VIDEO ─────────────────────────────────────────────────────────────────
exports.uploadVideo = [
  upload.single('video'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'Video file required (mp4/mov/avi, max 100MB)' });
      const result = await videoService.uploadVideo(
        req.params.listingId, req.user.id,
        req.file.buffer, req.file.mimetype, req.file.originalname
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      if (['Forbidden', 'Listing not found'].includes(err.message))
        return res.status(err.message === 'Forbidden' ? 403 : 404).json({ success: false, message: err.message });
      next(err);
    }
  },
];

exports.getVideos = async (req, res, next) => {
  try {
    const videos = await videoService.getVideos(req.params.listingId);
    res.json({ success: true, data: { videos } });
  } catch (err) { next(err); }
};

exports.deleteVideo = async (req, res, next) => {
  try {
    const result = await videoService.deleteVideo(req.params.videoId, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ success: false, message: err.message });
    next(err);
  }
};

exports.updateVideoLabel = async (req, res, next) => {
  try {
    const result = await videoService.updateLabel(req.params.videoId, req.user.id, req.body.label);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

// ── F06 EOI ───────────────────────────────────────────────────────────────────
exports.submitEOI = async (req, res, next) => {
  try {
    const { listingId, buyerName, buyerPhone, buyerEmail, offerPrice, message, signatureData } = req.body;
    if (!listingId || !buyerName || !buyerPhone || !offerPrice || !signatureData)
      return res.status(400).json({ success: false, message: 'listingId, buyerName, buyerPhone, offerPrice, signatureData are required' });
    const result = await eoiService.submitEOI({ listingId, buyerName, buyerPhone, buyerEmail, offerPrice, message, signatureData });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Listing not found or not active')
      return res.status(404).json({ success: false, message: err.message });
    next(err);
  }
};

exports.getEOIs = async (req, res, next) => {
  try {
    const eois = await eoiService.getEOIs(req.params.listingId, req.user.id);
    res.json({ success: true, data: { eois } });
  } catch (err) { next(err); }
};

exports.updateEOIStatus = async (req, res, next) => {
  try {
    const valid = ['accepted', 'rejected', 'expired'];
    if (!valid.includes(req.body.status))
      return res.status(400).json({ success: false, message: `status must be one of: ${valid.join(', ')}` });
    const eoi = await eoiService.updateEOIStatus(req.params.eoiId, req.user.id, req.body.status);
    res.json({ success: true, data: eoi });
  } catch (err) { next(err); }
};

// ── F07 COMMISSION ────────────────────────────────────────────────────────────
exports.calculateCommission = async (req, res, next) => {
  try {
    const { price, state, buyerGender, customCommissionRate, isRent } = req.query;
    if (!price) return res.status(400).json({ success: false, message: 'price is required' });
    const result = commissionService.calculate({
      price: parseFloat(price),
      state,
      buyerGender,
      customCommissionRate: customCommissionRate ? parseFloat(customCommissionRate) : null,
      isRent: isRent === 'true',
    });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Invalid price') return res.status(400).json({ success: false, message: err.message });
    next(err);
  }
};

exports.getStates = (req, res) => {
  res.json({ success: true, data: { states: commissionService.getAvailableStates() } });
};

// ── F08 FOLLOW-UPS ────────────────────────────────────────────────────────────
exports.getSequence = async (req, res, next) => {
  try {
    const steps = await followUpService.getSequence(req.params.leadId, req.user.id);
    res.json({ success: true, data: { steps } });
  } catch (err) { next(err); }
};

exports.toggleSequence = async (req, res, next) => {
  try {
    const pause = req.body.pause !== false;
    const result = await followUpService.toggleSequence(req.params.leadId, req.user.id, pause);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

exports.triggerFollowUpCron = async (req, res, next) => {
  try {
    if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET)
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await followUpService.processDueFollowUps();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};
