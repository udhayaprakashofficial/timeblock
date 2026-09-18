import type { Request, Response } from 'express';
import { handleVercelRequest } from './app-factory';

/**
 * Vercel serverless entry (compiled to dist/vercel.js).
 * Wired from /api via apps/server/api/index.js
 */
export default async function handler(req: Request, res: Response) {
  return handleVercelRequest(req, res);
}
