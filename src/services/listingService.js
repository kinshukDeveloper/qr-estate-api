const { query, getClient } = require('../config/database');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { createError } = require('../middleware/errorHandler');
const { nanoid } = require('nanoid');
const logger = require('../config/logger');

// ── CREATE LISTING ────────────────────────────────────────────────────────────
async function createListing(agentId, data) {
  const shortCode = nanoid(8); // e.g. "V7xKp2Qm"

  const {
    title, description, property_type, listing_type,
    price, price_negotiable,
    bedrooms, bathrooms, area_sqft, floor_number, total_floors,
    furnishing, facing,
    address, locality, city, state, pincode,
    latitude, longitude,
    amenities,
    status = 'draft',
  } = data;

  const result = await query(
    `INSERT INTO listings (
      agent_id, title, description, property_type, listing_type,
      price, price_negotiable,
      bedrooms, bathrooms, area_sqft, floor_number, total_floors,
      furnishing, facing,
      address, locality, city, state, pincode, latitude, longitude,
      amenities, status, short_code
    ) VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,
      $8,$9,$10,$11,$12,
      $13,$14,
      $15,$16,$17,$18,$19,$20,$21,
      $22,$23,$24
    )
    RETURNING *`,
    [
      agentId, title, description || null, property_type, listing_type,
      price, price_negotiable || false,
      bedrooms || null, bathrooms || null, area_sqft || null,
      floor_number || null, total_floors || null,
      furnishing || null, facing || null,
      address, locality || null, city, state, pincode || null,
      latitude || null, longitude || null,
      amenities || [], status, shortCode,
    ]
  );

  return result.rows[0];
}

// ── GET ALL LISTINGS (agent's own, paginated + filtered) ──────────────────────
async function getListings(agentId, filters = {}) {
  const {
    page = 1,
    limit = 10,
    status,
    property_type,
    listing_type,
    city,
    min_price,
    max_price,
    search,
  } = filters;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = ['l.agent_id = $1'];
  const values = [agentId];
  let paramCount = 2;

  if (status) {
    conditions.push(`l.status = $${paramCount}`);
    values.push(status);
    paramCount++;
  }
  if (property_type) {
    conditions.push(`l.property_type = $${paramCount}`);
    values.push(property_type);
    paramCount++;
  }
  if (listing_type) {
    conditions.push(`l.listing_type = $${paramCount}`);
    values.push(listing_type);
    paramCount++;
  }
  if (city) {
    conditions.push(`LOWER(l.city) = LOWER($${paramCount})`);
    values.push(city);
    paramCount++;
  }
  if (min_price) {
    conditions.push(`l.price >= $${paramCount}`);
    values.push(parseFloat(min_price));
    paramCount++;
  }
  if (max_price) {
    conditions.push(`l.price <= $${paramCount}`);
    values.push(parseFloat(max_price));
    paramCount++;
  }
  if (search) {
    conditions.push(`(l.title ILIKE $${paramCount} OR l.address ILIKE $${paramCount} OR l.locality ILIKE $${paramCount})`);
    values.push(`%${search}%`);
    paramCount++;
  }

  const WHERE = `WHERE ${conditions.join(' AND ')}`;

  // Total count
  const countResult = await query(
    `SELECT COUNT(*) FROM listings l ${WHERE}`,
    values
  );
  const total = parseInt(countResult.rows[0].count);

  // Paginated results
  values.push(parseInt(limit), offset);
  const result = await query(
    `SELECT l.*, 
            u.name as agent_name, u.phone as agent_phone, u.rera_number as agent_rera
     FROM listings l
     JOIN users u ON u.id = l.agent_id
     ${WHERE}
     ORDER BY l.created_at DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    values
  );

  return {
    listings: result.rows,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / parseInt(limit)),
      has_next: offset + result.rows.length < total,
      has_prev: parseInt(page) > 1,
    },
  };
}

// ── GET ONE LISTING ───────────────────────────────────────────────────────────
async function getListingById(listingId, agentId = null) {
  const result = await query(
    `SELECT l.*, 
            u.name as agent_name, u.phone as agent_phone, 
            u.rera_number as agent_rera, u.profile_photo as agent_photo
     FROM listings l
     JOIN users u ON u.id = l.agent_id
     WHERE l.id = $1`,
    [listingId]
  );

  const listing = result.rows[0];
  if (!listing) throw createError('Listing not found', 404);

  // If agentId provided, verify ownership
  if (agentId && listing.agent_id !== agentId) {
    throw createError('You do not have permission to access this listing', 403);
  }

  return listing;
}

// ── UPDATE LISTING ────────────────────────────────────────────────────────────
async function updateListing(listingId, agentId, data) {
  // Verify ownership first
  await getListingById(listingId, agentId);

  const allowedFields = [
    'title', 'description', 'property_type', 'listing_type',
    'price', 'price_negotiable', 'bedrooms', 'bathrooms',
    'area_sqft', 'floor_number', 'total_floors', 'furnishing', 'facing',
    'address', 'locality', 'city', 'state', 'pincode',
    'latitude', 'longitude', 'amenities', 'status',
  ];

  const updates = [];
  const values = [];
  let paramCount = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (allowedFields.includes(key) && value !== undefined) {
      updates.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  if (updates.length === 0) throw createError('No valid fields to update', 400);

  values.push(listingId);
  const result = await query(
    `UPDATE listings 
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${paramCount}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

// ── DELETE LISTING ────────────────────────────────────────────────────────────
async function deleteListing(listingId, agentId) {
  const listing = await getListingById(listingId, agentId);

  // Delete images from Cloudinary
  if (listing.images && listing.images.length > 0) {
    const deletePromises = listing.images
      .filter(img => img.public_id)
      .map(img => deleteFromCloudinary(img.public_id).catch(err => {
        logger.warn(`Failed to delete image ${img.public_id}:`, err.message);
      }));
    await Promise.all(deletePromises);
  }

  await query('DELETE FROM listings WHERE id = $1', [listingId]);
  return { id: listingId };
}

// ── UPDATE STATUS ─────────────────────────────────────────────────────────────
async function updateListingStatus(listingId, agentId, status) {
  const validStatuses = ['draft', 'active', 'sold', 'rented', 'inactive'];
  if (!validStatuses.includes(status)) {
    throw createError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
  }

  await getListingById(listingId, agentId);

  const result = await query(
    `UPDATE listings SET status = $1, updated_at = NOW() 
     WHERE id = $2 RETURNING id, status, title`,
    [status, listingId]
  );

  return result.rows[0];
}

// ── UPLOAD IMAGES ─────────────────────────────────────────────────────────────
async function uploadListingImages(listingId, agentId, files) {
  const listing = await getListingById(listingId, agentId);

  const currentImages = listing.images || [];
  if (currentImages.length + files.length > 10) {
    throw createError('Maximum 10 images per listing', 400);
  }

  // Upload all files to Cloudinary in parallel
  const uploadPromises = files.map((file, index) =>
    uploadToCloudinary(file.buffer, {
      folder: `qr-estate/listings/${listingId}`,
      public_id: `${listingId}_${Date.now()}_${index}`,
      transformation: [{ width: 1200, height: 900, crop: 'limit', quality: 'auto' }],
    })
  );

  const uploadResults = await Promise.all(uploadPromises);

  const newImages = uploadResults.map((result, index) => ({
    url: result.secure_url,
    public_id: result.public_id,
    width: result.width,
    height: result.height,
    is_primary: currentImages.length === 0 && index === 0, // first image is primary
  }));

  const allImages = [...currentImages, ...newImages];

  const result = await query(
    `UPDATE listings SET images = $1, updated_at = NOW() 
     WHERE id = $2 RETURNING id, images`,
    [JSON.stringify(allImages), listingId]
  );

  return result.rows[0];
}

// ── DELETE IMAGE ──────────────────────────────────────────────────────────────
async function deleteListingImage(listingId, agentId, publicId) {
  const listing = await getListingById(listingId, agentId);

  const images = listing.images || [];
  const imageExists = images.find(img => img.public_id === publicId);
  if (!imageExists) throw createError('Image not found', 404);

  // Delete from Cloudinary
  await deleteFromCloudinary(publicId);

  // Remove from array, reassign primary if needed
  let updatedImages = images.filter(img => img.public_id !== publicId);
  if (updatedImages.length > 0 && !updatedImages.some(img => img.is_primary)) {
    updatedImages[0].is_primary = true;
  }

  const result = await query(
    `UPDATE listings SET images = $1, updated_at = NOW() 
     WHERE id = $2 RETURNING id, images`,
    [JSON.stringify(updatedImages), listingId]
  );

  return result.rows[0];
}

// ── GET STATS (for dashboard) ─────────────────────────────────────────────────
async function getListingStats(agentId) {
  const result = await query(
    `SELECT 
      COUNT(*) FILTER (WHERE status = 'active') as active,
      COUNT(*) FILTER (WHERE status = 'draft') as draft,
      COUNT(*) FILTER (WHERE status = 'sold') as sold,
      COUNT(*) FILTER (WHERE status = 'rented') as rented,
      COUNT(*) as total,
      COALESCE(SUM(view_count), 0) as total_views
     FROM listings
     WHERE agent_id = $1`,
    [agentId]
  );

  return result.rows[0];
}

module.exports = {
  createListing,
  getListings,
  getListingById,
  updateListing,
  deleteListing,
  updateListingStatus,
  uploadListingImages,
  deleteListingImage,
  getListingStats,
};
