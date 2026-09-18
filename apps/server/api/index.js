/** Vercel serverless entry — delegates to Nest Express app built in dist/. */
module.exports = require('../dist/vercel.js').default;
