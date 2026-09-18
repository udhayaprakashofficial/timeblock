/**
 * Vercel catch-all: /api and /api/* → Nest Express app.
 * Keep req.url as the original path so Nest globalPrefix "api" matches.
 */
const path = require('path');
const fs = require('fs');

const handlerPath = path.join(__dirname, '..', 'dist', 'vercel.js');
if (!fs.existsSync(handlerPath)) {
  module.exports = (_req, res) => {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Nest build missing (dist/vercel.js). Check Vercel build logs.',
      }),
    );
  };
} else {
  module.exports = require(handlerPath).default;
}
