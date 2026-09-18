/**
 * Explicit Vercel serverless entry (framework: null).
 * Nest Fluid auto-detect was crashing; this loads the built Express app instead.
 */
const path = require('path');

let cached;

async function getExpress() {
  if (cached) return cached;
  // Ensure Vercel runtime flags are set before Nest boots
  process.env.VERCEL = process.env.VERCEL || '1';
  const { createNestApp } = require(path.join(__dirname, '..', 'dist', 'app-factory'));
  const app = await createNestApp();
  await app.init();
  cached = app.getHttpAdapter().getInstance();
  return cached;
}

module.exports = async function handler(req, res) {
  try {
    const server = await getExpress();
    return server(req, res);
  } catch (err) {
    console.error('[vercel-api] bootstrap failed', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'bootstrap_failed',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
};
