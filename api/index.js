let app;

try {
  app = require('../src/app');
  console.log("API file loaded ✅");
} catch (err) {
  console.error("IMPORT ERROR ❌", err);
}

module.exports = app;