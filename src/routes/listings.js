const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const listingController = require('../controllers/listingController');
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadMultiple } = require('../middleware/upload');

// All listing routes require authentication
router.use(authenticate);

// ── VALIDATION RULES ──────────────────────────────────────────────────────────
const createValidation = [
  body('title').trim().isLength({ min: 5, max: 200 }).withMessage('Title must be 5–200 characters'),
  body('property_type')
    .isIn(['apartment', 'villa', 'plot', 'commercial', 'pg', 'house'])
    .withMessage('Invalid property type'),
  body('listing_type')
    .isIn(['sale', 'rent'])
    .withMessage('listing_type must be sale or rent'),
  body('price')
    .isFloat({ min: 1 })
    .withMessage('Price must be a positive number'),
  body('address').trim().isLength({ min: 5 }).withMessage('Address is required'),
  body('city').trim().isLength({ min: 2 }).withMessage('City is required'),
  body('state').trim().isLength({ min: 2 }).withMessage('State is required'),
  body('bedrooms').optional().isInt({ min: 0, max: 20 }).withMessage('Bedrooms must be 0–20'),
  body('bathrooms').optional().isInt({ min: 0, max: 20 }).withMessage('Bathrooms must be 0–20'),
  body('area_sqft').optional().isFloat({ min: 1 }).withMessage('Area must be positive'),
  body('furnishing')
    .optional()
    .isIn(['unfurnished', 'semi-furnished', 'fully-furnished'])
    .withMessage('Invalid furnishing value'),
  body('status')
    .optional()
    .isIn(['draft', 'active'])
    .withMessage('Status on create must be draft or active'),
  body('amenities').optional().isArray().withMessage('Amenities must be an array'),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
];

const updateValidation = [
  body('title').optional().trim().isLength({ min: 5, max: 200 }),
  body('price').optional().isFloat({ min: 1 }),
  body('bedrooms').optional().isInt({ min: 0, max: 20 }),
  body('bathrooms').optional().isInt({ min: 0, max: 20 }),
  body('area_sqft').optional().isFloat({ min: 1 }),
  body('status')
    .optional()
    .isIn(['draft', 'active', 'sold', 'rented', 'inactive']),
  body('furnishing')
    .optional()
    .isIn(['unfurnished', 'semi-furnished', 'fully-furnished']),
];

// ── ROUTES ────────────────────────────────────────────────────────────────────

// GET /api/v1/listings/stats
router.get('/stats', asyncHandler(listingController.getStats));

// GET /api/v1/listings
router.get('/', asyncHandler(listingController.getAll));

// POST /api/v1/listings
router.post('/', createValidation, asyncHandler(listingController.create));

// GET /api/v1/listings/:id
router.get('/:id', asyncHandler(listingController.getOne));

// PATCH /api/v1/listings/:id
router.patch('/:id', updateValidation, asyncHandler(listingController.update));

// DELETE /api/v1/listings/:id
router.delete('/:id', asyncHandler(listingController.remove));

// PATCH /api/v1/listings/:id/status
router.patch('/:id/status', asyncHandler(listingController.updateStatus));

// POST /api/v1/listings/:id/images  (multipart/form-data, field: "images")
router.post('/:id/images', uploadMultiple, asyncHandler(listingController.uploadImages));

// DELETE /api/v1/listings/:id/images  (body: { public_id })
router.delete('/:id/images', asyncHandler(listingController.deleteImage));

module.exports = router;
