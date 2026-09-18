import type { Request, Response } from 'express';
import { handleVercelRequest } from './app-factory';

/**
 * Vercel serverless entry (compiled to dist/vercel.js).
 * Wired from apps/server/api/[[...path]].js
 */
export default async function handler(req: Request, res: Response) {
  // Ensure Nest sees /api/... even if the catch-all strips the prefix.
  const url = req.url || '/';
  if (!url.startsWith('/api')) {
    const q = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    const pathOnly = url.split('?')[0] || '/';
    const normalized = pathOnly === '/' ? '/api' : `/api${pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`}`;
    (req as { url: string }).url = `${normalized}${q}`;
  }
  return handleVercelRequest(req, res);
}
