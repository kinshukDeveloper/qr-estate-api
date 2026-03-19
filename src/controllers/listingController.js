const listingService = require('../services/listingService');
const { validationResult } = require('express-validator');

// ── CREATE ────────────────────────────────────────────────────────────────────
async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const listing = await listingService.createListing(req.user.id, req.body);

  res.status(201).json({
    success: true,
    message: 'Listing created',
    data: { listing },
  });
}

// ── GET ALL ───────────────────────────────────────────────────────────────────
async function getAll(req, res) {
  const result = await listingService.getListings(req.user.id, req.query);

  res.json({
    success: true,
    data: result,
  });
}

// ── GET ONE ───────────────────────────────────────────────────────────────────
async function getOne(req, res) {
  const listing = await listingService.getListingById(req.params.id, req.user.id);

  res.json({
    success: true,
    data: { listing },
  });
}

// ── UPDATE ────────────────────────────────────────────────────────────────────
async function update(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const listing = await listingService.updateListing(req.params.id, req.user.id, req.body);

  res.json({
    success: true,
    message: 'Listing updated',
    data: { listing },
  });
}

// ── DELETE ────────────────────────────────────────────────────────────────────
async function remove(req, res) {
  await listingService.deleteListing(req.params.id, req.user.id);

  res.json({
    success: true,
    message: 'Listing deleted',
  });
}

// ── UPDATE STATUS ─────────────────────────────────────────────────────────────
async function updateStatus(req, res) {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required' });
  }

  const listing = await listingService.updateListingStatus(req.params.id, req.user.id, status);

  res.json({
    success: true,
    message: `Listing marked as ${status}`,
    data: { listing },
  });
}

// ── UPLOAD IMAGES ─────────────────────────────────────────────────────────────
async function uploadImages(req, res) {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No images provided' });
  }

  const listing = await listingService.uploadListingImages(
    req.params.id,
    req.user.id,
    req.files
  );

  res.json({
    success: true,
    message: `${req.files.length} image(s) uploaded`,
    data: { listing },
  });
}

// ── DELETE IMAGE ──────────────────────────────────────────────────────────────
async function deleteImage(req, res) {
  const { public_id } = req.body;
  if (!public_id) {
    return res.status(400).json({ success: false, message: 'public_id is required' });
  }

  const listing = await listingService.deleteListingImage(
    req.params.id,
    req.user.id,
    public_id
  );

  res.json({
    success: true,
    message: 'Image deleted',
    data: { listing },
  });
}

// ── STATS ─────────────────────────────────────────────────────────────────────
async function getStats(req, res) {
  const stats = await listingService.getListingStats(req.user.id);

  res.json({
    success: true,
    data: { stats },
  });
}

module.exports = { create, getAll, getOne, update, remove, updateStatus, uploadImages, deleteImage, getStats };
