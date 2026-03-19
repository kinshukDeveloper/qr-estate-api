const logger = require('../config/logger');

/**
 * 404 handler — catches routes that don't exist
 */
function notFound(req, res, next) {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
}

/**
 * Global error handler — must have 4 params for Express to recognize it
 */
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';

  // Postgres errors
  if (err.code === '23505') {
    statusCode = 409;
    message = 'A record with this value already exists.';
  }
  if (err.code === '23503') {
    statusCode = 400;
    message = 'Referenced record does not exist.';
  }
  if (err.code === '22P02') {
    statusCode = 400;
    message = 'Invalid UUID format.';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token.';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired.';
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'File too large. Maximum size is 10MB.';
  }

  // Log server errors
  if (statusCode >= 500) {
    logger.error(`${statusCode} — ${message}`, {
      url: req.originalUrl,
      method: req.method,
      stack: err.stack,
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * Async wrapper — catches async errors and passes to errorHandler
 * Usage: router.get('/route', asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create a standard API error
 */
function createError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

module.exports = { notFound, errorHandler, asyncHandler, createError };
