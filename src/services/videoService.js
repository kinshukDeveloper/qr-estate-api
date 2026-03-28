const cloudinary = require('../config/cloudinary');
const { pool } = require('../config/database');

/**
 * F05 — Video Listings Service
 * Upload via Cloudinary (video resource type), store metadata in DB.
 * Max 100MB per video, mp4/mov/avi accepted.
 */

const MAX_VIDEOS_PER_LISTING = 3;
const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

async function uploadVideo(listingId, agentId, fileBuffer, mimetype, originalName) {
  // Verify listing ownership
  const listingRes = await pool.query(
    'SELECT id, agent_id FROM listings WHERE id=$1', [listingId]
  );
  if (!listingRes.rows.length) throw new Error('Listing not found');
  if (listingRes.rows[0].agent_id !== agentId) throw new Error('Forbidden');

  // Check count limit
  const countRes = await pool.query(
    'SELECT COUNT(*) FROM listing_videos WHERE listing_id=$1', [listingId]
  );
  if (parseInt(countRes.rows[0].count, 10) >= MAX_VIDEOS_PER_LISTING) {
    throw new Error(`Max ${MAX_VIDEOS_PER_LISTING} videos per listing`);
  }

  if (fileBuffer.length > MAX_SIZE_BYTES) {
    throw new Error('Video exceeds 100MB limit');
  }

  // Upload to Cloudinary
  const uploadResult = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: `qrestate/listings/${listingId}/videos`,
        eager: [{ format: 'jpg', transformation: [{ start_offset: '1' }] }], // thumbnail
        eager_async: true,
      },
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    stream.end(fileBuffer);
  });

  // Persist to DB
  const res = await pool.query(
    `INSERT INTO listing_videos
       (listing_id, cloudinary_public_id, url, thumbnail_url, duration_seconds, size_bytes, label)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      listingId,
      uploadResult.public_id,
      uploadResult.secure_url,
      uploadResult.eager?.[0]?.secure_url || null,
      Math.round(uploadResult.duration || 0),
      uploadResult.bytes,
      originalName.replace(/\.[^.]+$/, '') || 'Property Tour',
    ]
  );

  return res.rows[0];
}

async function getVideos(listingId) {
  const res = await pool.query(
    `SELECT * FROM listing_videos WHERE listing_id=$1 ORDER BY sort_order, created_at`,
    [listingId]
  );
  return res.rows;
}

async function deleteVideo(videoId, agentId) {
  const res = await pool.query(
    `SELECT lv.*, l.agent_id FROM listing_videos lv
     JOIN listings l ON l.id = lv.listing_id
     WHERE lv.id=$1`, [videoId]
  );
  if (!res.rows.length) throw new Error('Video not found');
  if (res.rows[0].agent_id !== agentId) throw new Error('Forbidden');

  await cloudinary.uploader.destroy(res.rows[0].cloudinary_public_id, { resource_type: 'video' });
  await pool.query('DELETE FROM listing_videos WHERE id=$1', [videoId]);
  return { deleted: true };
}

async function updateLabel(videoId, agentId, label) {
  const res = await pool.query(
    `SELECT lv.id, l.agent_id FROM listing_videos lv
     JOIN listings l ON l.id=lv.listing_id WHERE lv.id=$1`, [videoId]
  );
  if (!res.rows.length) throw new Error('Not found');
  if (res.rows[0].agent_id !== agentId) throw new Error('Forbidden');
  await pool.query('UPDATE listing_videos SET label=$1 WHERE id=$2', [label, videoId]);
  return { updated: true };
}

module.exports = { uploadVideo, getVideos, deleteVideo, updateLabel };
