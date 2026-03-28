const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { query } = require('../config/database');
const { generateTokens, verifyRefreshToken } = require('../services/tokenService');
const { setEx, get, del } = require('../config/redis');
const { createError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// ── REGISTER ─────────────────────────────────────────────────────────────────
async function register(req, res) {
  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { name, email, password, phone, rera_number, role = 'agent' } = req.body;

  // Only allow agent or agency_admin (admin is created via CLI/seed)
  const allowedRoles = ['agent', 'agency_admin'];
  if (!allowedRoles.includes(role)) {
    throw createError('Invalid role specified', 400);
  }

  // Check if email already exists
  const existing = await query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );
  if (existing.rows.length > 0) {
    throw createError('An account with this email already exists', 409);
  }

  // Hash password
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const password_hash = await bcrypt.hash(password, saltRounds);

  // Insert user
  const result = await query(
    `INSERT INTO users (name, email, password_hash, phone, rera_number, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email, phone, rera_number, role, created_at`,
    [name, email, password_hash, phone || null, rera_number || null, role]
  );

  const user = result.rows[0];

  // Generate tokens
  const { accessToken, refreshToken } = await generateTokens(user);

  logger.info(`New user registered: ${email} (${role})`);

  res.status(201).json({
    success: true,
    message: 'Account created successfully',
    data: {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    },
  });
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { email, password } = req.body;

  // Find user
  const result = await query(
    'SELECT id, name, email, password_hash, phone, rera_number, role, is_active, created_at FROM users WHERE email = $1',
    [email]
  );

  const user = result.rows[0];

  // Generic message — don't reveal if email exists
  const invalidCredentials = createError('Invalid email or password', 401);

  if (!user) throw invalidCredentials;
  if (!user.is_active) throw createError('Account is deactivated. Contact support.', 403);

  // Verify password
  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) throw invalidCredentials;

  // Generate tokens
  const { accessToken, refreshToken } = await generateTokens(user);

  // Update last_login
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  logger.info(`User logged in: ${email}`);

  res.json({
    success: true,
    message: 'Logged in successfully',
    data: {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    },
  });
}

// ── REFRESH TOKEN ─────────────────────────────────────────────────────────────
async function refreshToken(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) throw createError('Refresh token required', 400);

  // Verify and decode
  const decoded = await verifyRefreshToken(refreshToken);

  // Check if token is blacklisted (logged out)
  const blacklisted = await get(`blacklist:${refreshToken}`);
  if (blacklisted) throw createError('Token has been revoked', 401);

  // Get fresh user data
  const result = await query(
    'SELECT id, name, email, phone, rera_number, role, is_active FROM users WHERE id = $1',
    [decoded.userId]
  );

  const user = result.rows[0];
  if (!user || !user.is_active) throw createError('User not found or inactive', 401);

  // Issue new tokens (token rotation)
  const tokens = await generateTokens(user);

  // Blacklist old refresh token
  const refreshExpiry = 7 * 24 * 60 * 60; // 7 days in seconds
  await setEx(`blacklist:${refreshToken}`, '1', refreshExpiry);

  res.json({
    success: true,
    data: tokens,
  });
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
async function logout(req, res) {
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.split(' ')[1];
  const { refreshToken } = req.body;

  // Blacklist access token (for remaining TTL)
  if (accessToken) {
    await setEx(`blacklist:${accessToken}`, '1', 15 * 60); // 15 min
  }

  // Blacklist refresh token
  if (refreshToken) {
    await setEx(`blacklist:${refreshToken}`, '1', 7 * 24 * 60 * 60); // 7 days
  }

  logger.info(`User logged out: ${req.user.email}`);

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}

// ── GET ME ────────────────────────────────────────────────────────────────────
async function getMe(req, res) {
  const result = await query(
    `SELECT id, name, email, phone, rera_number, role, profile_photo, 
            is_active, last_login, created_at 
     FROM users WHERE id = $1`,
    [req.user.id]
  );

  if (!result.rows[0]) throw createError('User not found', 404);

  res.json({
    success: true,
    data: { user: sanitizeUser(result.rows[0]) },
  });
}

// ── UPDATE PROFILE ────────────────────────────────────────────────────────────
async function updateProfile(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { name, phone, rera_number } = req.body;
  const allowedFields = { name, phone, rera_number };

  // Build dynamic SET clause (only update provided fields)
  const updates = [];
  const values = [];
  let paramCount = 1;

  Object.entries(allowedFields).forEach(([key, value]) => {
    if (value !== undefined) {
      updates.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  if (updates.length === 0) throw createError('No fields to update', 400);

  values.push(req.user.id);
  const result = await query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() 
     WHERE id = $${paramCount} 
     RETURNING id, name, email, phone, rera_number, role`,
    values
  );

  res.json({
    success: true,
    message: 'Profile updated',
    data: { user: sanitizeUser(result.rows[0]) },
  });
}

// ── HELPER ────────────────────────────────────────────────────────────────────
function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

module.exports = { register, login, refreshToken, logout, getMe, updateProfile };
