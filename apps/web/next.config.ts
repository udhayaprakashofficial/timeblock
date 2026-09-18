import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

const nextConfig: NextConfig = {
  transpilePackages: ['@timeblock/shared-types'],
  // Keep tracing inside this monorepo (avoid parent ~/package-lock.json)
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Avoid covering the sidebar Logout control in the bottom-left.
  devIndicators: {
    position: 'bottom-right',
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
