const agencyService = require('../services/agencyService');
const { validationResult } = require('express-validator');
const { createError } = require('../middleware/errorHandler');

// POST /api/v1/agencies
async function createAgency(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  const agency = await agencyService.createAgency(req.user.id, req.body);
  res.status(201).json({ success: true, message: 'Agency created', data: { agency } });
}

// GET /api/v1/agencies/me
async function getMyAgency(req, res) {
  const agency = await agencyService.getMyAgency(req.user.id);
  res.json({ success: true, data: { agency } });
}

// PATCH /api/v1/agencies/me
async function updateAgency(req, res) {
  if (!req.user.agency_id) throw createError('No agency context', 403);
  const agency = await agencyService.updateAgency(req.user.agency_id, req.body);
  res.json({ success: true, message: 'Agency updated', data: { agency } });
}

// GET /api/v1/agencies/members
async function getMembers(req, res) {
  if (!req.user.agency_id) throw createError('No agency context', 403);
  const members = await agencyService.getMembers(req.user.agency_id);
  res.json({ success: true, data: { members } });
}

// POST /api/v1/agencies/invite
async function inviteMember(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  if (!req.user.agency_id) throw createError('No agency context', 403);
  const result = await agencyService.inviteMember(
    req.user.agency_id,
    req.user.id,
    req.body
  );
  res.status(201).json({
    success: true,
    message: `Invite sent to ${req.body.email}`,
    data: result,
  });
}

// GET /api/v1/agencies/invites
async function getPendingInvites(req, res) {
  if (!req.user.agency_id) throw createError('No agency context', 403);
  const invites = await agencyService.getPendingInvites(req.user.agency_id);
  res.json({ success: true, data: { invites } });
}

// GET /api/v1/agencies/invite/validate?token=XXX  (public)
async function validateInviteToken(req, res) {
  const { token } = req.query;
  if (!token) throw createError('Token required', 400);
  const invite = await agencyService.validateInviteToken(token);
  res.json({ success: true, data: { invite } });
}

// POST /api/v1/agencies/invite/accept   body: { token }
async function acceptInvite(req, res) {
  const { token } = req.body;
  if (!token) throw createError('Token required', 400);
  const result = await agencyService.acceptInvite(token, req.user.id);
  res.json({ success: true, message: 'You have joined the agency!', data: result });
}

// DELETE /api/v1/agencies/invites/:inviteId
async function cancelInvite(req, res) {
  if (!req.user.agency_id) throw createError('No agency context', 403);
  await agencyService.cancelInvite(req.user.agency_id, req.params.inviteId);
  res.json({ success: true, message: 'Invite cancelled' });
}

// PATCH /api/v1/agencies/invites/:inviteId/resend
async function resendInvite(req, res) {
  if (!req.user.agency_id) throw createError('No agency context', 403);
  const result = await agencyService.resendInvite(req.user.agency_id, req.params.inviteId);
  res.json({ success: true, message: 'Invite resent', data: result });
}

// DELETE /api/v1/agencies/members/:userId
async function removeMember(req, res) {
  if (!req.user.agency_id) throw createError('No agency context', 403);
  await agencyService.removeMember(req.user.agency_id, req.params.userId, req.user.id);
  res.json({ success: true, message: 'Member removed' });
}

// PATCH /api/v1/agencies/members/:userId/role    body: { role }
async function updateMemberRole(req, res) {
  if (!req.user.agency_id) throw createError('No agency context', 403);
  const { role } = req.body;
  await agencyService.updateMemberRole(
    req.user.agency_id,
    req.params.userId,
    role,
    req.user.id
  );
  res.json({ success: true, message: `Role updated to ${role}` });
}

module.exports = {
  createAgency,
  getMyAgency,
  updateAgency,
  getMembers,
  inviteMember,
  getPendingInvites,
  validateInviteToken,
  acceptInvite,
  cancelInvite,
  resendInvite,
  removeMember,
  updateMemberRole,
};
