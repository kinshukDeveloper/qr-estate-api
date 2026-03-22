const express = require('express');
const router = express.Router();
const qrController = require('../controllers/qrController');
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');

// All routes require auth
router.use(authenticate);

// POST /api/v1/qr/generate
router.post('/generate', asyncHandler(qrController.generate));

// GET /api/v1/qr
router.get('/', asyncHandler(qrController.getAll));

// GET /api/v1/qr/:id
router.get('/:id', asyncHandler(qrController.getOne));

// GET /api/v1/qr/:id/download?format=png|svg
router.get('/:id/download', asyncHandler(qrController.download));

// GET /api/v1/qr/:id/analytics?days=30
router.get('/:id/analytics', asyncHandler(qrController.analytics));

// PATCH /api/v1/qr/:id/toggle
router.patch('/:id/toggle', asyncHandler(qrController.toggleActive));

module.exports = router;
