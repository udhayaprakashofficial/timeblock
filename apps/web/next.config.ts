import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Stable Nest production host — never a hashed preview URL (those are SSO-protected). */
const PROD_API_ORIGIN = 'https://timeblock-server.vercel.app';

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
    // Browser stays on https://app.cupkey.io/api/* (first-party cookies).
    // Next rewrites server-side to Nest — users never see timeblock-server.
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
