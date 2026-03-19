/**
 * Vercel Serverless Entry Point
 * This file exports the Express app for Vercel to handle.
 * Vercel wraps this in a serverless function automatically.
 */
const app = require('../src/app');

module.exports = app;
