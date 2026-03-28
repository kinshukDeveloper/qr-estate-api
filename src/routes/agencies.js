const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const c = require('../controllers/agencyController');
const { authenticate, authorizeAgency } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');

// ── PUBLIC ────────────────────────────────────────────────────────────────────

// GET /api/v1/agencies/invite/validate?token=XXX
// Used by /join page to preview the invite before login
router.get(
  '/invite/validate',
  asyncHandler(c.validateInviteToken)
);

// ── ALL BELOW REQUIRE AUTH ────────────────────────────────────────────────────
router.use(authenticate);

// ── AGENCY CRUD ───────────────────────────────────────────────────────────────

// POST /api/v1/agencies  — create a new agency (any logged-in user)
router.post(
  '/',
  [body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Agency name 2–120 chars')],
  asyncHandler(c.createAgency)
);

// GET /api/v1/agencies/me  — my agency details
router.get('/me', asyncHandler(c.getMyAgency));

// PATCH /api/v1/agencies/me  — update agency (owner/admin only)
router.patch(
  '/me',
  authorizeAgency('owner', 'agency_admin'),
  [body('name').optional().trim().isLength({ min: 2, max: 120 })],
  asyncHandler(c.updateAgency)
);

// ── MEMBERS ───────────────────────────────────────────────────────────────────

// GET /api/v1/agencies/members  — list all team members
router.get('/members', asyncHandler(c.getMembers));

// DELETE /api/v1/agencies/members/:userId  — remove a member
router.delete(
  '/members/:userId',
  authorizeAgency('owner', 'agency_admin'),
  asyncHandler(c.removeMember)
);

// PATCH /api/v1/agencies/members/:userId/role  — change a member's role
router.patch(
  '/members/:userId/role',
  authorizeAgency('owner'),
  [body('role').isIn(['agency_admin', 'agent', 'viewer']).withMessage('Invalid role')],
  asyncHandler(c.updateMemberRole)
);

// ── INVITES ───────────────────────────────────────────────────────────────────

// POST /api/v1/agencies/invite  — send an invite email
router.post(
  '/invite',
  authorizeAgency('owner', 'agency_admin'),
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('role')
      .isIn(['agency_admin', 'agent', 'viewer'])
      .withMessage('Role must be: agency_admin, agent, viewer'),
  ],
  asyncHandler(c.inviteMember)
);

// GET /api/v1/agencies/invites  — list pending invites
router.get(
  '/invites',
  authorizeAgency('owner', 'agency_admin'),
  asyncHandler(c.getPendingInvites)
);

// DELETE /api/v1/agencies/invites/:inviteId  — cancel invite
router.delete(
  '/invites/:inviteId',
  authorizeAgency('owner', 'agency_admin'),
  asyncHandler(c.cancelInvite)
);

// PATCH /api/v1/agencies/invites/:inviteId/resend  — resend invite
router.patch(
  '/invites/:inviteId/resend',
  authorizeAgency('owner', 'agency_admin'),
  asyncHandler(c.resendInvite)
);

// POST /api/v1/agencies/invite/accept  — accept an invite (logged-in user)
router.post(
  '/invite/accept',
  [body('token').notEmpty().withMessage('Token required')],
  asyncHandler(c.acceptInvite)
);

module.exports = router;
