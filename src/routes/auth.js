const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');

// Stricter rate limit for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});

// ── VALIDATION RULES ──────────────────────────────────────────────────────────
const registerValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('Name must be 2–80 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Enter a valid email'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and a number'),
  body('phone')
    .optional()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Enter a valid 10-digit Indian mobile number'),
  body('rera_number')
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('RERA number must be 3–50 characters'),
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email'),
  body('password').notEmpty().withMessage('Password is required'),
];

// ── ROUTES ────────────────────────────────────────────────────────────────────

// POST /api/v1/auth/register
router.post(
  '/register',
  authLimiter,
  registerValidation,
  asyncHandler(authController.register)
);

// POST /api/v1/auth/login
router.post(
  '/login',
  authLimiter,
  loginValidation,
  asyncHandler(authController.login)
);

// POST /api/v1/auth/refresh
// Body: { refreshToken }
router.post(
  '/refresh',
  asyncHandler(authController.refreshToken)
);

// POST /api/v1/auth/logout  [requires auth]
router.post(
  '/logout',
  authenticate,
  asyncHandler(authController.logout)
);

// GET /api/v1/auth/me  [requires auth]
router.get(
  '/me',
  authenticate,
  asyncHandler(authController.getMe)
);

// PATCH /api/v1/auth/profile  [requires auth]
router.patch(
  '/profile',
  authenticate,
  [
    body('name').optional().trim().isLength({ min: 2, max: 80 }),
    body('phone').optional().matches(/^[6-9]\d{9}$/),
    body('rera_number').optional().trim().isLength({ min: 3, max: 50 }),
  ],
  asyncHandler(authController.updateProfile)
);

module.exports = router;
