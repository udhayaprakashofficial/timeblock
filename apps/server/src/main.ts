import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Express } from 'express';
import { createExpressApp } from './app-factory';

// Ensure Vercel Nest entrypoint detection sees @nestjs/core in src/main.ts
void NestFactory;

let cached: Express | null = null;

async function getApp(): Promise<Express> {
  if (!cached) {
    cached = await createExpressApp();
  }
  return cached;
}

/** Vercel Functions entry — Nest zero-config expects a default export or listen(). */
export default async function handler(req: Request, res: Response) {
  const app = await getApp();
  return app(req, res);
}

async function bootstrapLocal() {
  const isProd = process.env.NODE_ENV === 'production';
  const server = await getApp();
  const port = Number(process.env.PORT ?? 3001);

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve()).on('error', reject);
  });

  const googleOn = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
  console.log(`API listening on http://localhost:${port}`);
  console.log(
    `Google signup: ${
      googleOn
        ? 'enabled'
        : 'DISABLED — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in apps/server/.env'
    }`,
  );
  if (isProd) {
    console.log(`App: http://localhost:${port}`);
  }
}

// Local / non-Vercel: listen on a port. On Vercel, the default export is used.
if (!process.env.VERCEL) {
  bootstrapLocal().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
