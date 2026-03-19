const qrService = require('../services/qrService');

async function generate(req, res) {
  const { listing_id, style, foreground_color, background_color, include_frame, frame_label } = req.body;
  if (!listing_id) return res.status(400).json({ success: false, message: 'listing_id is required' });

  const qr = await qrService.generateQR(req.user.id, listing_id, {
    style, foreground_color, background_color, include_frame, frame_label,
  });

  res.status(201).json({
    success: true, message: 'QR code generated',
    data: {
      qr: {
        id: qr.id, short_code: qr.short_code, target_url: qr.target_url,
        qr_url: qr.qr_url, scan_count: qr.scan_count, style: qr.style,
        foreground_color: qr.foreground_color, background_color: qr.background_color,
        include_frame: qr.include_frame, frame_label: qr.frame_label,
        listing_title: qr.listing_title, created_at: qr.created_at,
      },
    },
  });
}

async function getAll(req, res) {
  const qrCodes = await qrService.getQRCodes(req.user.id);
  res.json({ success: true, data: { qr_codes: qrCodes } });
}

async function getOne(req, res) {
  const qr = await qrService.getQRCode(req.params.id, req.user.id);
  res.json({ success: true, data: { qr } });
}

async function download(req, res) {
  const format = req.query.format || 'png';
  const { buffer, mimeType, ext } = await qrService.downloadQR(req.params.id, req.user.id, format);
  res.set({
    'Content-Type': mimeType,
    'Content-Disposition': `attachment; filename="qr-estate-${req.params.id}.${ext}"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
}

async function analytics(req, res) {
  const days = parseInt(req.query.days) || 30;
  const data = await qrService.getScanAnalytics(req.params.id, req.user.id, days);
  res.json({ success: true, data });
}

async function toggleActive(req, res) {
  const result = await qrService.toggleQRActive(req.params.id, req.user.id);
  res.json({
    success: true,
    message: result.is_active ? 'QR code activated' : 'QR code deactivated',
    data: result,
  });
}

async function redirectQR(req, res) {
  const { shortCode } = req.params;
  const { redirect } = await qrService.handleRedirect(shortCode, req);
  res.redirect(302, redirect);
}

module.exports = { generate, getAll, getOne, download, analytics, toggleActive, redirectQR };
