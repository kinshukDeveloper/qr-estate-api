const crypto = require('crypto');
const { pool } = require('../config/database');
const cloudinary = require('../config/cloudinary');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

/**
 * F09 — Document Management Vault
 *
 * Flow:
 *   Agent uploads docs (PDF, images) → stored on Cloudinary
 *   Public docs: visible to anyone on property page
 *   Private docs: buyer submits access request
 *   Agent approves → 48h signed Cloudinary URL generated → emailed to buyer
 */

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE     = 20 * 1024 * 1024; // 20MB

function getMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function uploadDocument(listingId, agentId, fileBuffer, mimetype, { docType, label, isPublic = false }) {
  if (!ALLOWED_MIME.includes(mimetype)) throw new Error('Only PDF, JPG, PNG, WEBP allowed');
  if (fileBuffer.length > MAX_SIZE)     throw new Error('File exceeds 20MB limit');

  // Verify ownership
  const check = await pool.query(`SELECT id FROM listings WHERE id=$1 AND agent_id=$2`, [listingId, agentId]);
  if (!check.rows.length) throw new Error('Listing not found or forbidden');

  const resourceType = mimetype === 'application/pdf' ? 'raw' : 'image';
  const uploadResult = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder: `qrestate/docs/${listingId}`, format: mimetype === 'application/pdf' ? 'pdf' : undefined },
      (err, res) => { if (err) reject(err); else resolve(res); }
    );
    stream.end(fileBuffer);
  });

  const res = await pool.query(
    `INSERT INTO listing_documents (listing_id, agent_id, doc_type, label, cloudinary_public_id, url, size_bytes, is_public)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [listingId, agentId, docType, label, uploadResult.public_id, uploadResult.secure_url, fileBuffer.length, isPublic]
  );
  return res.rows[0];
}

// ── List docs for a listing ───────────────────────────────────────────────────
async function getDocuments(listingId, requestingAgentId = null) {
  // Agents see all; public sees only is_public=true
  const where = requestingAgentId ? 'listing_id=$1' : 'listing_id=$1 AND is_public=true';
  const res = await pool.query(
    `SELECT id, doc_type, label, size_bytes, is_public, created_at FROM listing_documents WHERE ${where} ORDER BY created_at`,
    [listingId]
  );
  return res.rows;
}

// ── Delete a doc ──────────────────────────────────────────────────────────────
async function deleteDocument(docId, agentId) {
  const res = await pool.query(
    `SELECT ld.*, l.agent_id AS owner FROM listing_documents ld JOIN listings l ON l.id=ld.listing_id WHERE ld.id=$1`, [docId]
  );
  if (!res.rows.length)               throw new Error('Document not found');
  if (res.rows[0].owner !== agentId)  throw new Error('Forbidden');
  await cloudinary.uploader.destroy(res.rows[0].cloudinary_public_id, { resource_type: 'raw' }).catch(() => {});
  await pool.query('DELETE FROM listing_documents WHERE id=$1', [docId]);
  return { deleted: true };
}

// ── Buyer: request access ─────────────────────────────────────────────────────
async function requestAccess(docId, { buyerName, buyerEmail, buyerPhone, message }) {
  // Check doc exists and is private
  const docRes = await pool.query(
    `SELECT ld.*, l.title AS listing_title, u.email AS agent_email, u.name AS agent_name
     FROM listing_documents ld
     JOIN listings l ON l.id=ld.listing_id
     JOIN users u ON u.id=ld.agent_id
     WHERE ld.id=$1`, [docId]
  );
  if (!docRes.rows.length) throw new Error('Document not found');
  const doc = docRes.rows[0];
  if (doc.is_public) throw new Error('This document is publicly accessible — no request needed');

  const res = await pool.query(
    `INSERT INTO document_access_requests (document_id, buyer_name, buyer_email, buyer_phone, message)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *`,
    [docId, buyerName, buyerEmail, buyerPhone || null, message || null]
  );

  // Notify agent
  if (process.env.SMTP_USER) {
    const mailer = getMailer();
    await mailer.sendMail({
      from: `"QR Estate" <${process.env.SMTP_USER}>`,
      to: doc.agent_email,
      subject: `Document Access Request: ${buyerName} wants "${doc.label}"`,
      html: `<div style="font-family:sans-serif;background:#07090D;color:#EEE8DC;padding:24px;border-radius:8px;border:1px solid #1B2330">
        <h2 style="color:#E8B84B;margin:0 0 12px">Document Access Request</h2>
        <p><b style="color:#fff">${buyerName}</b> (${buyerEmail}) is requesting access to <b style="color:#fff">"${doc.label}"</b> for listing <b style="color:#fff">${doc.listing_title}</b>.</p>
        ${message ? `<p style="color:#8899AA;font-style:italic">"${message}"</p>` : ''}
        <a href="${process.env.FRONTEND_URL}/dashboard/documents/${docId}/requests" style="display:inline-block;background:#E8B84B;color:#000;font-weight:700;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:12px">Review Request →</a>
      </div>`,
    }).catch((e) => logger.warn(`[DocVault] Email failed: ${e.message}`));
  }

  return { message: 'Request submitted. The agent will review and respond.' };
}

// ── Agent: approve request → generate expiring URL ────────────────────────────
async function approveRequest(requestId, agentId) {
  const res = await pool.query(
    `SELECT dar.*, ld.cloudinary_public_id, ld.label, ld.agent_id,
            u.email AS buyer_email, u2.name AS agent_name
     FROM document_access_requests dar
     JOIN listing_documents ld ON ld.id=dar.document_id
     LEFT JOIN users u2 ON u2.id=ld.agent_id
     WHERE dar.id=$1`, [requestId]
  );
  if (!res.rows.length)               throw new Error('Request not found');
  if (res.rows[0].agent_id !== agentId) throw new Error('Forbidden');

  const req = res.rows[0];
  const accessToken = crypto.randomBytes(32).toString('hex');
  const expiresAt   = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

  await pool.query(
    `UPDATE document_access_requests SET status='approved', access_token=$1, expires_at=$2, updated_at=now() WHERE id=$3`,
    [accessToken, expiresAt, requestId]
  );

  // Generate Cloudinary signed URL (48h)
  const signedUrl = cloudinary.url(req.cloudinary_public_id, {
    resource_type: 'raw', sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + 48 * 3600,
    type: 'authenticated',
  });

  // Email buyer
  if (process.env.SMTP_USER) {
    const mailer = getMailer();
    await mailer.sendMail({
      from: `"${req.agent_name || 'QR Estate'}" <${process.env.SMTP_USER}>`,
      to: req.buyer_email,
      subject: `Document Access Approved: "${req.label}"`,
      html: `<div style="font-family:sans-serif;background:#07090D;color:#EEE8DC;padding:24px;border-radius:8px;border:1px solid #1B2330">
        <h2 style="color:#28D890;margin:0 0 12px">✅ Access Approved</h2>
        <p>Your request for <b style="color:#fff">"${req.label}"</b> has been approved.</p>
        <p style="color:#8899AA;font-size:13px">⚠️ This link expires in <b style="color:#fff">48 hours</b>.</p>
        <a href="${signedUrl}" style="display:inline-block;background:#28D890;color:#000;font-weight:700;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:12px">Download Document →</a>
      </div>`,
    }).catch((e) => logger.warn(`[DocVault] Approval email failed: ${e.message}`));
  }

  return { approved: true, expiresAt };
}

// ── Agent: reject request ─────────────────────────────────────────────────────
async function rejectRequest(requestId, agentId) {
  const res = await pool.query(
    `SELECT dar.*, ld.agent_id FROM document_access_requests dar JOIN listing_documents ld ON ld.id=dar.document_id WHERE dar.id=$1`, [requestId]
  );
  if (!res.rows.length)                throw new Error('Request not found');
  if (res.rows[0].agent_id !== agentId) throw new Error('Forbidden');
  await pool.query(`UPDATE document_access_requests SET status='rejected', updated_at=now() WHERE id=$1`, [requestId]);
  return { rejected: true };
}

// ── Secure download via access_token ─────────────────────────────────────────
async function getSecureDownload(accessToken) {
  const res = await pool.query(
    `SELECT dar.*, ld.cloudinary_public_id, ld.label
     FROM document_access_requests dar
     JOIN listing_documents ld ON ld.id=dar.document_id
     WHERE dar.access_token=$1 AND dar.status='approved' AND dar.expires_at > now()`,
    [accessToken]
  );
  if (!res.rows.length) throw new Error('Invalid or expired access token');
  const signedUrl = cloudinary.url(res.rows[0].cloudinary_public_id, {
    resource_type: 'raw', sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    type: 'authenticated',
  });
  return { url: signedUrl, label: res.rows[0].label };
}

// ── Get requests for agent ────────────────────────────────────────────────────
async function getRequests(listingId, agentId) {
  const res = await pool.query(
    `SELECT dar.*, ld.label AS doc_label, ld.doc_type
     FROM document_access_requests dar
     JOIN listing_documents ld ON ld.id=dar.document_id
     JOIN listings l ON l.id=ld.listing_id
     WHERE l.id=$1 AND l.agent_id=$2
     ORDER BY dar.created_at DESC`,
    [listingId, agentId]
  );
  return res.rows;
}

module.exports = { uploadDocument, getDocuments, deleteDocument, requestAccess, approveRequest, rejectRequest, getSecureDownload, getRequests };
