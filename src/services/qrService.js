const QRCode = require('qrcode');
const sharp = require('sharp');
const { query } = require('../config/database');
const { uploadToCloudinary } = require('../config/cloudinary');
const { createError } = require('../middleware/errorHandler');
const { nanoid } = require('nanoid');
const logger = require('../config/logger');

// ── GENERATE QR CODE ──────────────────────────────────────────────────────────
async function generateQR(agentId, listingId, options = {}) {
  // Verify listing belongs to agent
  const listingResult = await query(
    'SELECT id, title, short_code, status FROM listings WHERE id = $1 AND agent_id = $2',
    [listingId, agentId]
  );
  const listing = listingResult.rows[0];
  if (!listing) throw createError('Listing not found or access denied', 404);

  // Check if QR already exists for this listing
  const existing = await query(
    'SELECT * FROM qr_codes WHERE listing_id = $1 AND agent_id = $2',
    [listingId, agentId]
  );

  const {
    style = 'standard',
    foreground_color = '#000000',
    background_color = '#FFFFFF',
    include_logo = false,
    include_frame = false,
    frame_label = 'Scan to View Property',
  } = options;

  // Short code for redirect URL
  const shortCode = existing.rows[0]?.short_code || nanoid(8);
  const targetUrl = `${process.env.APP_URL || 'http://localhost:5000'}/q/${shortCode}`;

  // Generate QR as PNG buffer
  const qrBuffer = await QRCode.toBuffer(targetUrl, {
    errorCorrectionLevel: 'H', // High — allows logo overlay
    type: 'png',
    width: 600,
    margin: 2,
    color: {
      dark: foreground_color,
      light: background_color,
    },
  });

  // Apply frame/branding if requested
  let finalBuffer = qrBuffer;
  if (include_frame) {
    finalBuffer = await addFrame(qrBuffer, frame_label, foreground_color);
  }

  // Upload to Cloudinary
  let qrUrl = null;
  let qrPublicId = null;

  try {
    const uploadResult = await uploadToCloudinary(finalBuffer, {
      folder: `qr-estate/qr-codes/${agentId}`,
      public_id: `qr_${listingId}`,
      format: 'png',
      overwrite: true,
    });
    qrUrl = uploadResult.secure_url;
    qrPublicId = uploadResult.public_id;
  } catch (err) {
    logger.warn('Cloudinary upload failed, storing QR as base64:', err.message);
    // Fallback: return as base64 without storing
    qrUrl = `data:image/png;base64,${finalBuffer.toString('base64')}`;
  }

  // Upsert QR code record
  let qrRecord;
  if (existing.rows[0]) {
    const result = await query(
      `UPDATE qr_codes SET
        style = $1, foreground_color = $2, background_color = $3,
        include_logo = $4, include_frame = $5, frame_label = $6,
        qr_url = $7, qr_public_id = $8, target_url = $9,
        is_active = true, updated_at = NOW()
       WHERE listing_id = $10 AND agent_id = $11
       RETURNING *`,
      [
        style, foreground_color, background_color,
        include_logo, include_frame, frame_label,
        qrUrl, qrPublicId, targetUrl,
        listingId, agentId,
      ]
    );
    qrRecord = result.rows[0];
  } else {
    const result = await query(
      `INSERT INTO qr_codes (
        listing_id, agent_id, short_code, style,
        foreground_color, background_color,
        include_logo, include_frame, frame_label,
        qr_url, qr_public_id, target_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        listingId, agentId, shortCode, style,
        foreground_color, background_color,
        include_logo, include_frame, frame_label,
        qrUrl, qrPublicId, targetUrl,
      ]
    );
    qrRecord = result.rows[0];
  }

  // Also store short_code on listing for direct reference
  await query(
    'UPDATE listings SET short_code = $1 WHERE id = $2',
    [shortCode, listingId]
  );

  return {
    ...qrRecord,
    listing_title: listing.title,
    qr_image_buffer: finalBuffer, // for direct download
  };
}

// ── ADD FRAME AROUND QR ───────────────────────────────────────────────────────
async function addFrame(qrBuffer, label, color = '#000000') {
  const FRAME_PAD = 40;
  const LABEL_HEIGHT = 50;
  const qrSize = 600;
  const totalWidth = qrSize + FRAME_PAD * 2;
  const totalHeight = qrSize + FRAME_PAD * 2 + LABEL_HEIGHT;

  // Create white background canvas
  const canvas = sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  });

  // Create SVG label
  const labelSvg = Buffer.from(`
    <svg width="${totalWidth}" height="${LABEL_HEIGHT}">
      <rect width="${totalWidth}" height="${LABEL_HEIGHT}" fill="${color}"/>
      <text
        x="${totalWidth / 2}" y="${LABEL_HEIGHT / 2 + 6}"
        font-family="Arial, sans-serif" font-size="18" font-weight="bold"
        fill="white" text-anchor="middle"
      >${label}</text>
    </svg>
  `);

  const framedBuffer = await canvas.composite([
    { input: qrBuffer, top: FRAME_PAD, left: FRAME_PAD },
    { input: labelSvg, top: qrSize + FRAME_PAD * 2, left: 0 },
  ]).png().toBuffer();

  return framedBuffer;
}

// ── GET QR CODES (agent's listings) ──────────────────────────────────────────
async function getQRCodes(agentId) {
  const result = await query(
    `SELECT q.*, l.title as listing_title, l.status as listing_status,
            l.city, l.property_type, l.listing_type, l.price
     FROM qr_codes q
     JOIN listings l ON l.id = q.listing_id
     WHERE q.agent_id = $1
     ORDER BY q.created_at DESC`,
    [agentId]
  );
  return result.rows;
}

// ── GET ONE QR CODE ───────────────────────────────────────────────────────────
async function getQRCode(qrId, agentId) {
  const result = await query(
    `SELECT q.*, l.title as listing_title, l.status as listing_status,
            l.city, l.address, l.property_type, l.listing_type, l.price,
            l.images as listing_images
     FROM qr_codes q
     JOIN listings l ON l.id = q.listing_id
     WHERE q.id = $1 AND q.agent_id = $2`,
    [qrId, agentId]
  );
  if (!result.rows[0]) throw createError('QR code not found', 404);
  return result.rows[0];
}

// ── DOWNLOAD QR (raw PNG buffer) ──────────────────────────────────────────────
async function downloadQR(qrId, agentId, format = 'png') {
  const qr = await getQRCode(qrId, agentId);

  // Regenerate fresh from target URL
  const buffer = await QRCode.toBuffer(qr.target_url, {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: 1000,
    margin: 2,
    color: {
      dark: qr.foreground_color,
      light: qr.background_color,
    },
  });

  let finalBuffer = buffer;
  if (qr.include_frame) {
    finalBuffer = await addFrame(buffer, qr.frame_label, qr.foreground_color);
  }

  if (format === 'svg') {
    const svg = await QRCode.toString(qr.target_url, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      color: { dark: qr.foreground_color, light: qr.background_color },
    });
    return { buffer: Buffer.from(svg), mimeType: 'image/svg+xml', ext: 'svg' };
  }

  return { buffer: finalBuffer, mimeType: 'image/png', ext: 'png' };
}

// ── HANDLE QR REDIRECT ────────────────────────────────────────────────────────
async function handleRedirect(shortCode, req) {
  const result = await query(
    `SELECT q.*, l.status as listing_status
     FROM qr_codes q
     JOIN listings l ON l.id = q.listing_id
     WHERE q.short_code = $1`,
    [shortCode]
  );

  const qr = result.rows[0];

  if (!qr) {
    return { redirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/not-found` };
  }

  // Determine device type
  const ua = req.headers['user-agent'] || '';
  const deviceType = /mobile/i.test(ua) ? 'mobile' : /tablet/i.test(ua) ? 'tablet' : 'desktop';

  // Record scan asynchronously (don't block redirect)
  recordScan(qr, req, deviceType).catch(err =>
    logger.warn('Scan recording failed:', err.message)
  );

  // If listing is sold/rented/inactive, redirect to a "property unavailable" page
  if (['sold', 'rented', 'inactive'].includes(qr.listing_status)) {
    const unavailableUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/p/${shortCode}?unavailable=true`;
    return { redirect: unavailableUrl };
  }

  // Redirect to public property page
  const propertyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/p/${shortCode}`;
  return { redirect: propertyUrl };
}

// ── RECORD SCAN ───────────────────────────────────────────────────────────────
async function recordScan(qr, req, deviceType) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  await query(
    `INSERT INTO qr_scans (qr_code_id, listing_id, ip_address, user_agent, device_type, referrer)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [qr.id, qr.listing_id, ip, req.headers['user-agent'] || null, deviceType, req.headers.referer || null]
  );

  // Increment counters
  await query('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = $1', [qr.id]);
  await query('UPDATE listings SET view_count = view_count + 1 WHERE id = $1', [qr.listing_id]);
}

// ── GET SCAN ANALYTICS ────────────────────────────────────────────────────────
async function getScanAnalytics(qrId, agentId, days = 30) {
  // Verify ownership
  await getQRCode(qrId, agentId);

  const [totalResult, deviceResult, dailyResult] = await Promise.all([
    // Total scans
    query('SELECT COUNT(*) as total FROM qr_scans WHERE qr_code_id = $1', [qrId]),

    // By device
    query(
      `SELECT device_type, COUNT(*) as count
       FROM qr_scans WHERE qr_code_id = $1
       GROUP BY device_type ORDER BY count DESC`,
      [qrId]
    ),

    // Daily for last N days
    query(
      `SELECT DATE(scanned_at) as date, COUNT(*) as scans
       FROM qr_scans
       WHERE qr_code_id = $1 AND scanned_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(scanned_at) ORDER BY date ASC`,
      [qrId]
    ),
  ]);

  return {
    total_scans: parseInt(totalResult.rows[0].total),
    by_device: deviceResult.rows,
    daily: dailyResult.rows,
  };
}

// ── TOGGLE QR ACTIVE ──────────────────────────────────────────────────────────
async function toggleQRActive(qrId, agentId) {
  await getQRCode(qrId, agentId);
  const result = await query(
    'UPDATE qr_codes SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING id, is_active',
    [qrId]
  );
  return result.rows[0];
}

module.exports = {
  generateQR,
  getQRCodes,
  getQRCode,
  downloadQR,
  handleRedirect,
  getScanAnalytics,
  toggleQRActive,
};
