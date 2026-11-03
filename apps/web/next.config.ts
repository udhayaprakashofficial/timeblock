import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Stable Nest production host — never a hashed preview URL (those are SSO-protected). */
const PROD_API_ORIGIN = 'https://timeblock-server.vercel.app';

/**
 * Nest controller prefixes proxied from the web host.
 * `/api/ai/*` is intentionally excluded — Next App Router owns the AI BFF
 * (including the dynamic `[...path]` catch-all). `afterFiles` rewrites run
 * *before* dynamic routes, so a blanket `/api/:path*` rewrite was sending
 * Spotlight calls to stale Nest and returning `Cannot POST /api/ai/task-post`.
 */
const NEST_API_PREFIX =
  'auth|users|tasks|calendar|billing|admin|timer|stats|schedule|health|internal|public';

function isEphemeralVercelHost(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    // e.g. timeblock-server-hgy0iedhh.vercel.app — Deployment Protection → 401
    return (
      host.endsWith('.vercel.app') &&
      host !== 'timeblock-server.vercel.app' &&
      host !== 'timeblock-web-ashy.vercel.app'
    );
  } catch {
    return true;
  }
}

function resolveApiOrigin(): string {
  if (!process.env.VERCEL) {
    return (
      process.env.API_ORIGIN?.replace(/\/$/, '') || 'http://127.0.0.1:3001'
    );
  }
  const fromEnv = process.env.API_ORIGIN?.replace(/\/$/, '') ?? '';
  // Production / app.cupkey.io must always proxy to the public alias.
  if (process.env.VERCEL_ENV === 'production' || !fromEnv) {
    return PROD_API_ORIGIN;
  }
  if (isEphemeralVercelHost(fromEnv)) {
    console.warn(
      `[next.config] Ignoring protected preview API_ORIGIN=${fromEnv}; using ${PROD_API_ORIGIN}`,
    );
    return PROD_API_ORIGIN;
  }
  return fromEnv;
}

const apiOrigin = resolveApiOrigin();

const nextConfig: NextConfig = {
  transpilePackages: ['@timeblock/shared-types'],
  // Keep tracing inside this monorepo (avoid parent ~/package-lock.json)
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Avoid covering the sidebar Logout control in the bottom-left.
  devIndicators: {
    position: 'bottom-right',
  },
  async rewrites() {
    // afterFiles: static App Router handlers (e.g. /api/auth/google) win first.
    // Dynamic catch-alls do NOT — so never blanket-proxy `/api/ai/*` to Nest.
    return {
      afterFiles: [
        {
          // Dodo dashboard endpoint configured as https://app.cupkey.io/webhook
          source: '/webhook',
          destination: `${apiOrigin}/api/billing/webhook`,
        },
        {
          source: '/api/billing/webhook',
          destination: `${apiOrigin}/api/billing/webhook`,
        },
        {
          source: `/api/:nest(${NEST_API_PREFIX})/:path*`,
          destination: `${apiOrigin}/api/:nest/:path*`,
        },
        {
          source: `/api/:nest(${NEST_API_PREFIX})`,
          destination: `${apiOrigin}/api/:nest`,
        },
      ],
    };
  },
};

export default nextConfig;
