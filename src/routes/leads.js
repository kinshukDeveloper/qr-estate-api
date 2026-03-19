const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');

// Public route — buyer enquiry from property page (no auth)
router.post('/enquiry/:shortCode', asyncHandler(leadController.capturePublic));

// All routes below require auth
router.use(authenticate);

router.get('/stats', asyncHandler(leadController.getStats));
router.get('/', asyncHandler(leadController.getAll));
router.post('/', asyncHandler(leadController.create));
router.get('/:id', asyncHandler(leadController.getOne));
router.patch('/:id', asyncHandler(leadController.update));
router.delete('/:id', asyncHandler(leadController.remove));

module.exports = router;
