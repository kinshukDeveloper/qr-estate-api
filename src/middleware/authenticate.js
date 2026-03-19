const { verifyAccessToken } = require('../services/tokenService');
const { get } = require('../config/redis');
const { createError } = require('./errorHandler');

/**
 * Authenticate middleware — verifies JWT access token
 * Attaches req.user = { id, email, role }
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

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Role guard middleware
 * Usage: authorize('admin')  or  authorize('admin', 'agency_admin')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError('Not authenticated', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(createError(`Access denied. Required role: ${roles.join(' or ')}`, 403));
    }
    next();
  };
}

module.exports = { authenticate, authorize };
