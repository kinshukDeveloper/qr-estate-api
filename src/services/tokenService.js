const jwt = require('jsonwebtoken');
const { setEx } = require('../config/redis');
const { createError } = require('../middleware/errorHandler');

/**
 * Generate access + refresh tokens for a user
 */
async function generateTokens(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  // Store refresh token in Redis (for validation + revocation)
  const ttl = 7 * 24 * 60 * 60; // 7 days
  await setEx(`refresh:${user.id}:${refreshToken.slice(-10)}`, {
    userId: user.id,
    email: user.email,
  }, ttl);

  return { accessToken, refreshToken };
}

/**
 * Verify a refresh token
 */
async function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw createError('Refresh token expired. Please log in again.', 401);
    }
    throw createError('Invalid refresh token.', 401);
  }
}

/**
 * Verify an access token
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw createError('Access token expired.', 401);
    }
    throw createError('Invalid access token.', 401);
  }
}

module.exports = { generateTokens, verifyRefreshToken, verifyAccessToken };
