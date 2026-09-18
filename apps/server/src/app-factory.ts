/**
 * Shared Nest bootstrap for local + Vercel (Fluid / Nest zero-config).
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

loadEnv({ path: resolve(__dirname, '../.env'), override: true });
loadEnv({ path: resolve(__dirname, '../../../.env'), override: false });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser = require('cookie-parser');
import session = require('express-session');
import express = require('express');
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { PrismaSessionStore } from './auth/prisma-session.store';

function isVercelRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

function sessionSecret(): string {
  const v = process.env.SESSION_SECRET?.trim();
  if (v) return v;
  if (isVercelRuntime()) {
    console.error(
      '[session] SESSION_SECRET is not set — using a temporary secret. Set SESSION_SECRET in Vercel env!',
    );
    return `vercel-temp-${process.env.VERCEL_GIT_COMMIT_SHA || 'timeblock'}`;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[prod] SESSION_SECRET must be set (e.g. openssl rand -base64 48)',
    );
  }
  return 'dev-session-secret-change-me';
}

export async function createNestApp(): Promise<NestExpressApplication> {
  const isProd = process.env.NODE_ENV === 'production' || isVercelRuntime();
  const server = express();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    { logger: ['error', 'warn', 'log'] },
  );

  server.set('trust proxy', 1);
  app.use(cookieParser());

  let sessionStore: session.Store = new session.MemoryStore();

  // On Vercel, skip Prisma TCP at boot (often blocked / engine missing).
  // Prefer Supabase pooler DATABASE_URL (:6543) for durable sessions later.
  if (!isVercelRuntime()) {
    try {
      const sessionPrisma = new PrismaClient();
      await sessionPrisma.$connect();
      sessionStore = new PrismaSessionStore(sessionPrisma);
      console.log('[session] Using Postgres session store (Supabase)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[session] DATABASE_URL unreachable:', msg);
      throw new Error(
        'DATABASE_URL must reach Supabase Postgres. File sessions are disabled.',
      );
    }
  } else {
    console.warn(
      '[session] Vercel: using MemoryStore (set pooler DATABASE_URL for durable sessions)',
    );
  }

  const crossSite = Boolean(process.env.WEB_ORIGIN?.includes('vercel.app'));

  app.use(
    session({
      name: 'timeblock.sid',
      secret: sessionSecret(),
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      proxy: true,
      cookie: {
        httpOnly: true,
        sameSite: crossSite ? 'none' : 'lax',
        secure: isProd || crossSite,
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  const allowedOrigins = new Set(
    (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  // Always allow the production web host
  allowedOrigins.add('https://timeblock-web-ashy.vercel.app');

  if (!isProd) {
    for (const o of [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5199',
      'http://localhost:5199',
      'http://127.0.0.1:5201',
      'http://localhost:5201',
    ]) {
      allowedOrigins.add(o);
    }
  }

  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!requestOrigin || allowedOrigins.has(requestOrigin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const serveWeb =
    isProd && !isVercelRuntime() && process.env.SERVE_WEB !== 'false';
  if (serveWeb) {
    const webDist = resolve(__dirname, '../../web/dist');
    if (!existsSync(webDist)) {
      throw new Error(
        `[prod] Missing web build at ${webDist}. Run: npm run build -w @timeblock/web`,
      );
    }
    server.use(express.static(webDist, { index: false }));
    server.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
    console.log(`[prod] Serving web from ${webDist}`);
  }

  return app;
}
