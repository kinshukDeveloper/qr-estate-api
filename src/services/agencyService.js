const { query, getClient } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { nanoid } = require('nanoid');
const logger = require('../config/logger');

// ── PLAN SEAT LIMITS ──────────────────────────────────────────────────────────
const PLAN_SEATS = { free: 1, pro: 5, agency: 25 };

// ── CREATE AGENCY ─────────────────────────────────────────────────────────────
async function createAgency(ownerId, { name, website, logo_url }) {
  // Check user doesn't already own or belong to an agency
  const existing = await query(
    'SELECT agency_id FROM users WHERE id = $1',
    [ownerId]
  );
  if (existing.rows[0]?.agency_id) {
    throw createError('You already belong to an agency. Leave it before creating a new one.', 409);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Create agency
    const agRes = await client.query(
      `INSERT INTO agencies (name, owner_id, plan, max_agents, website, logo_url)
       VALUES ($1, $2, 'free', $3, $4, $5)
       RETURNING *`,
      [name, ownerId, PLAN_SEATS.free, website || null, logo_url || null]
    );
    const agency = agRes.rows[0];

    // Link owner to agency
    await client.query(
      `UPDATE users
       SET agency_id = $1, agency_role = 'owner', role = 'agency_admin'
       WHERE id = $2`,
      [agency.id, ownerId]
    );

    // Insert into agency_members
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by)
       VALUES ($1, $2, 'owner', $2)`,
      [agency.id, ownerId]
    );

    // Set agency_id on existing listings + leads owned by this user
    await client.query(
      `UPDATE listings SET agency_id = $1 WHERE agent_id = $2 AND agency_id IS NULL`,
      [agency.id, ownerId]
    );
    await client.query(
      `UPDATE leads SET agency_id = $1 WHERE agent_id = $2 AND agency_id IS NULL`,
      [agency.id, ownerId]
    );

    await client.query('COMMIT');
    logger.info(`Agency created: ${agency.id} by ${ownerId}`);
    return agency;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── GET MY AGENCY ─────────────────────────────────────────────────────────────
async function getMyAgency(userId) {
  const result = await query(
    `SELECT a.*,
            COUNT(am.user_id) AS member_count,
            u.name AS owner_name
     FROM agencies a
     JOIN agency_members am ON am.agency_id = a.id
     JOIN users u ON u.id = a.owner_id
     WHERE a.id = (SELECT agency_id FROM users WHERE id = $1)
     GROUP BY a.id, u.name`,
    [userId]
  );
  if (!result.rows[0]) throw createError('You are not part of any agency', 404);
  return result.rows[0];
}

// ── GET MEMBERS ───────────────────────────────────────────────────────────────
async function getMembers(agencyId) {
  const result = await query(
    `SELECT
       u.id, u.name, u.email, u.phone, u.profile_photo,
       am.role AS agency_role, am.joined_at,
       ib.name AS invited_by_name,
       COUNT(l.id)::int AS listing_count,
       COUNT(ld.id)::int AS lead_count
     FROM agency_members am
     JOIN users u ON u.id = am.user_id
     LEFT JOIN users ib ON ib.id = am.invited_by
     LEFT JOIN listings l ON l.agent_id = u.id AND l.agency_id = am.agency_id
     LEFT JOIN leads ld ON ld.agent_id = u.id AND ld.agency_id = am.agency_id
     WHERE am.agency_id = $1
     GROUP BY u.id, u.name, u.email, u.phone, u.profile_photo,
              am.role, am.joined_at, ib.name
     ORDER BY am.joined_at ASC`,
    [agencyId]
  );
  return result.rows;
}

// ── INVITE MEMBER ─────────────────────────────────────────────────────────────
async function inviteMember(agencyId, inviterId, { email, role }) {
  // Check seat limit
  const agRes = await query(
    'SELECT plan, max_agents FROM agencies WHERE id = $1',
    [agencyId]
  );
  const agency = agRes.rows[0];
  if (!agency) throw createError('Agency not found', 404);

  const countRes = await query(
    'SELECT COUNT(*) FROM agency_members WHERE agency_id = $1',
    [agencyId]
  );
  const currentCount = parseInt(countRes.rows[0].count);
  if (currentCount >= agency.max_agents) {
    throw createError(
      `Seat limit reached (${agency.max_agents} on ${agency.plan} plan). Upgrade to add more agents.`,
      403
    );
  }

  // Check if already a member
  const memberCheck = await query(
    `SELECT am.id FROM agency_members am
     JOIN users u ON u.id = am.user_id
     WHERE am.agency_id = $1 AND u.email = $2`,
    [agencyId, email]
  );
  if (memberCheck.rows.length) throw createError('This email is already a team member', 409);

  // Check for existing pending invite
  const pendingCheck = await query(
    `SELECT id FROM agency_invites
     WHERE agency_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > NOW()`,
    [agencyId, email]
  );
  if (pendingCheck.rows.length) throw createError('A pending invite for this email already exists', 409);

  // Create invite token
  const token = nanoid(32);
  const result = await query(
    `INSERT INTO agency_invites (agency_id, email, role, token, invited_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [agencyId, email, role, token, inviterId]
  );

  const invite = result.rows[0];
  const inviteUrl = `${process.env.FRONTEND_URL}/join?token=${token}`;

  logger.info(`Invite created: ${email} → agency ${agencyId} (${role})`);

  // TODO: Send via SendGrid — for now return URL for manual testing
  return { invite, inviteUrl };
}

// ── GET PENDING INVITES ───────────────────────────────────────────────────────
async function getPendingInvites(agencyId) {
  const result = await query(
    `SELECT ai.*, u.name AS invited_by_name
     FROM agency_invites ai
     LEFT JOIN users u ON u.id = ai.invited_by
     WHERE ai.agency_id = $1
       AND ai.accepted_at IS NULL
       AND ai.expires_at > NOW()
     ORDER BY ai.created_at DESC`,
    [agencyId]
  );
  return result.rows;
}

// ── ACCEPT INVITE ─────────────────────────────────────────────────────────────
async function acceptInvite(token, userId) {
  // Validate token
  const invRes = await query(
    `SELECT * FROM agency_invites
     WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
    [token]
  );
  const invite = invRes.rows[0];
  if (!invite) throw createError('Invite link is invalid or has expired', 400);

  // Check user email matches
  const userRes = await query('SELECT email, agency_id FROM users WHERE id = $1', [userId]);
  const user = userRes.rows[0];
  if (!user) throw createError('User not found', 404);
  if (user.email !== invite.email) {
    throw createError('This invite was sent to a different email address', 403);
  }
  if (user.agency_id) {
    throw createError('You already belong to an agency. Leave it first.', 409);
  }

  // Check seat limit again
  const agRes = await query(
    'SELECT max_agents, plan FROM agencies WHERE id = $1',
    [invite.agency_id]
  );
  const agency = agRes.rows[0];
  const countRes = await query(
    'SELECT COUNT(*) FROM agency_members WHERE agency_id = $1',
    [invite.agency_id]
  );
  if (parseInt(countRes.rows[0].count) >= agency.max_agents) {
    throw createError('Agency seat limit reached. Contact the agency admin.', 403);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Mark invite accepted
    await client.query(
      'UPDATE agency_invites SET accepted_at = NOW() WHERE id = $1',
      [invite.id]
    );

    // Add to agency_members
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agency_id, user_id) DO NOTHING`,
      [invite.agency_id, userId, invite.role, invite.invited_by]
    );

    // Update users
    await client.query(
      `UPDATE users
       SET agency_id = $1, agency_role = $2,
           role = CASE WHEN $2 = 'agency_admin' THEN 'agency_admin' ELSE 'agent' END
       WHERE id = $3`,
      [invite.agency_id, invite.role, userId]
    );

    // Assign existing listings/leads to agency
    await client.query(
      `UPDATE listings SET agency_id = $1 WHERE agent_id = $2 AND agency_id IS NULL`,
      [invite.agency_id, userId]
    );
    await client.query(
      `UPDATE leads SET agency_id = $1 WHERE agent_id = $2 AND agency_id IS NULL`,
      [invite.agency_id, userId]
    );

    await client.query('COMMIT');
    logger.info(`Invite accepted: user ${userId} joined agency ${invite.agency_id}`);
    return { agency_id: invite.agency_id, role: invite.role };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── VALIDATE INVITE TOKEN (public, no auth) ───────────────────────────────────
async function validateInviteToken(token) {
  const result = await query(
    `SELECT ai.*, a.name AS agency_name, u.name AS invited_by_name
     FROM agency_invites ai
     JOIN agencies a ON a.id = ai.agency_id
     LEFT JOIN users u ON u.id = ai.invited_by
     WHERE ai.token = $1`,
    [token]
  );
  const invite = result.rows[0];
  if (!invite) throw createError('Invite not found', 404);
  if (invite.accepted_at) throw createError('This invite has already been used', 400);
  if (new Date(invite.expires_at) < new Date()) throw createError('Invite has expired', 400);
  return invite;
}

// ── REMOVE MEMBER ─────────────────────────────────────────────────────────────
async function removeMember(agencyId, targetUserId, requesterId) {
  // Can't remove yourself if you're the owner
  const memberRes = await query(
    'SELECT role FROM agency_members WHERE agency_id = $1 AND user_id = $2',
    [agencyId, targetUserId]
  );
  const member = memberRes.rows[0];
  if (!member) throw createError('Member not found in this agency', 404);
  if (member.role === 'owner') throw createError('Cannot remove the agency owner', 403);
  if (targetUserId === requesterId) throw createError('Use /leave to leave the agency yourself', 400);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM agency_members WHERE agency_id = $1 AND user_id = $2',
      [agencyId, targetUserId]
    );
    await client.query(
      `UPDATE users SET agency_id = NULL, agency_role = NULL, role = 'agent'
       WHERE id = $1`,
      [targetUserId]
    );
    // Keep their listings/leads but unlink from agency
    await client.query(
      'UPDATE listings SET agency_id = NULL WHERE agent_id = $1 AND agency_id = $2',
      [targetUserId, agencyId]
    );
    await client.query('COMMIT');
    logger.info(`Member ${targetUserId} removed from agency ${agencyId} by ${requesterId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── CANCEL INVITE ─────────────────────────────────────────────────────────────
async function cancelInvite(agencyId, inviteId) {
  const result = await query(
    'DELETE FROM agency_invites WHERE id = $1 AND agency_id = $2 RETURNING id',
    [inviteId, agencyId]
  );
  if (!result.rows[0]) throw createError('Invite not found', 404);
}

// ── RESEND INVITE ─────────────────────────────────────────────────────────────
async function resendInvite(agencyId, inviteId) {
  // Extend expiry by 48h and regenerate token
  const newToken = nanoid(32);
  const result = await query(
    `UPDATE agency_invites
     SET token = $1, expires_at = NOW() + INTERVAL '48 hours'
     WHERE id = $2 AND agency_id = $3 AND accepted_at IS NULL
     RETURNING *, $4::text AS invite_url`,
    [newToken, inviteId, agencyId, `${process.env.FRONTEND_URL}/join?token=${newToken}`]
  );
  if (!result.rows[0]) throw createError('Invite not found or already accepted', 404);
  const invite = result.rows[0];
  const inviteUrl = `${process.env.FRONTEND_URL}/join?token=${newToken}`;
  return { invite, inviteUrl };
}

// ── UPDATE MEMBER ROLE ────────────────────────────────────────────────────────
async function updateMemberRole(agencyId, targetUserId, newRole, requesterId) {
  const memberRes = await query(
    'SELECT role FROM agency_members WHERE agency_id = $1 AND user_id = $2',
    [agencyId, targetUserId]
  );
  const member = memberRes.rows[0];
  if (!member) throw createError('Member not found', 404);
  if (member.role === 'owner') throw createError('Cannot change owner role', 403);
  if (targetUserId === requesterId) throw createError('Cannot change your own role', 400);
  if (!['agency_admin', 'agent', 'viewer'].includes(newRole)) {
    throw createError('Invalid role. Must be: agency_admin, agent, viewer', 400);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE agency_members SET role = $1 WHERE agency_id = $2 AND user_id = $3',
      [newRole, agencyId, targetUserId]
    );
    await client.query(
      `UPDATE users
       SET agency_role = $1,
           role = CASE WHEN $1 = 'agency_admin' THEN 'agency_admin' ELSE 'agent' END
       WHERE id = $2`,
      [newRole, targetUserId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── UPDATE AGENCY ─────────────────────────────────────────────────────────────
async function updateAgency(agencyId, { name, website, logo_url }) {
  const updates = [];
  const values = [];
  let i = 1;
  if (name)     { updates.push(`name = $${i++}`);     values.push(name); }
  if (website !== undefined)  { updates.push(`website = $${i++}`);  values.push(website); }
  if (logo_url !== undefined) { updates.push(`logo_url = $${i++}`); values.push(logo_url); }
  if (!updates.length) throw createError('No fields to update', 400);
  values.push(agencyId);
  const result = await query(
    `UPDATE agencies SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${i} RETURNING *`,
    values
  );
  return result.rows[0];
}

module.exports = {
  createAgency,
  getMyAgency,
  getMembers,
  inviteMember,
  getPendingInvites,
  acceptInvite,
  validateInviteToken,
  removeMember,
  cancelInvite,
  resendInvite,
  updateMemberRole,
  updateAgency,
  PLAN_SEATS,
};
