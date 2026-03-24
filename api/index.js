/**
 * Vercel Serverless Entry Point
 * This file exports the Express app for Vercel to handle.
 * Vercel wraps this in a serverless function automatically.
 */
const app = require('../src/app');
console.log("API file loaded");


module.exports = app;
