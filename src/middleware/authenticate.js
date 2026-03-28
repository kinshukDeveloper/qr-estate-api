const { verifyAccessToken } = require('../services/tokenService');
const { get } = require('../config/redis');
const { query } = require('../config/database');
const { createError } = require('./errorHandler');

/**
 * authenticate — verifies JWT, attaches req.user
 * req.user = { id, email, role, agency_id, agency_role }
 *
 * agency_id / agency_role are null for solo agents not in any agency.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError('Authorization token required', 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) throw createError('Token missing', 401);

    // Check blacklist (logged out tokens)
    const blacklisted = await get(`blacklist:${token}`);
    if (blacklisted) throw createError('Token has been revoked. Please log in again.', 401);

    // Verify token
    const decoded = verifyAccessToken(token);

    // Load fresh user row — picks up agency_id / agency_role changes without
    // requiring a new login
    const result = await query(
      `SELECT id, email, role, agency_id, agency_role, is_active
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    const user = result.rows[0];
    if (!user) throw createError('User not found', 401);
    if (!user.is_active) throw createError('Account is deactivated', 403);

    req.user = {
      id:           user.id,
      email:        user.email,
      role:         user.role,         // global role: agent | agency_admin | admin
      agency_id:    user.agency_id,    // null if solo
      agency_role:  user.agency_role,  // owner | agency_admin | agent | viewer | null
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * optionalAuthenticate — same as authenticate but DOES NOT throw error
 * If token exists → attach user
 * If not → continue as guest
 */
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // No token → just continue (guest user)
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next();

    // Check blacklist
    const blacklisted = await get(`blacklist:${token}`);
    if (blacklisted) return next();

    // Verify token
    const decoded = verifyAccessToken(token);

    const result = await query(
      `SELECT id, email, role, agency_id, agency_role, is_active
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) return next();

    // Attach user if valid
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      agency_id: user.agency_id,
      agency_role: user.agency_role,
    };

    next();
  } catch (err) {
    // IMPORTANT: don't break request
    next();
  }
}
/**
 * authorize — role guard for global roles
 * Usage: authorize('admin') or authorize('admin', 'agency_admin')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(createError('Not authenticated', 401));
    if (!roles.includes(req.user.role)) {
      return next(createError(`Access denied. Required: ${roles.join(' or ')}`, 403));
    }
    next();
  };
}

/**
 * authorizeAgency — role guard for agency-scoped roles
 * Usage: authorizeAgency('owner', 'agency_admin')
 */
function authorizeAgency(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(createError('Not authenticated', 401));
    if (!req.user.agency_id) return next(createError('No agency context', 403));
    if (!roles.includes(req.user.agency_role)) {
      return next(createError(`Agency role required: ${roles.join(' or ')}`, 403));
    }
    next();
  };
}

module.exports = {
  authenticate,
  optionalAuthenticate, // 🔥 THIS WAS MISSING
  authorize,
  authorizeAgency
};