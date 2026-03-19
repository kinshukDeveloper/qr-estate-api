const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { asyncHandler, createError } = require('../middleware/errorHandler');

// GET /api/v1/p/:shortCode — public, no auth required
router.get('/:shortCode', asyncHandler(async (req, res) => {
  const { shortCode } = req.params;

  const result = await query(
    `SELECT 
       l.id, l.title, l.description, l.property_type, l.listing_type,
       l.price, l.price_negotiable,
       l.bedrooms, l.bathrooms, l.area_sqft, l.floor_number, l.total_floors,
       l.furnishing, l.facing, l.address, l.locality, l.city, l.state,
       l.pincode, l.latitude, l.longitude, l.images, l.amenities,
       l.status, l.view_count, l.short_code, l.created_at,
       u.name  AS agent_name,
       u.phone AS agent_phone,
       u.rera_number AS agent_rera,
       u.profile_photo AS agent_photo,
       q.id         AS qr_id,
       q.scan_count AS qr_scans
     FROM listings l
     JOIN users u ON u.id = l.agent_id
     LEFT JOIN qr_codes q ON q.listing_id = l.id
     WHERE l.short_code = $1`,
    [shortCode]
  );

  const listing = result.rows[0];
  if (!listing) throw createError('Property not found', 404);

  // Increment view count (fire-and-forget)
  query('UPDATE listings SET view_count = view_count + 1 WHERE short_code = $1', [shortCode])
    .catch(() => {});

  res.json({ success: true, data: { listing } });
}));

module.exports = router;
