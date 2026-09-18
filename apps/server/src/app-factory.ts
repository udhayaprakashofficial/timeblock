/**
 * Shared Nest + Express bootstrap for local listen and Vercel serverless.
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
import type { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { PrismaSessionStore } from './auth/prisma-session.store';

function requireProdSecret(
  name: string,
  value: string | undefined,
  fallback: string,
) {
  const v = value?.trim();
  if (process.env.NODE_ENV === 'production') {
    if (!v || v === fallback) {
      throw new Error(
        `[prod] ${name} must be set to a strong random value (e.g. openssl rand -base64 48)`,
      );
    }
    return v;
  }
  return v || fallback;
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

export async function createExpressApp(): Promise<Express> {
  const isProd = process.env.NODE_ENV === 'production' || isVercelRuntime();
  const server = express();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    { logger: isVercelRuntime() ? ['error', 'warn', 'log'] : undefined },
  );

  server.set('trust proxy', 1);
  app.use(cookieParser());

  let sessionStore: session.Store;
  try {
    const sessionPrisma = new PrismaClient();
    await sessionPrisma.$connect();
    sessionStore = new PrismaSessionStore(sessionPrisma);
    console.log('[session] Using Postgres session store (Supabase)');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[session] DATABASE_URL unreachable:', msg);
    throw new Error(
      'DATABASE_URL must reach Supabase Postgres (db.<project>.supabase.co:5432). File sessions are disabled.',
    );
  }

  const sessionSecret = requireProdSecret(
    'SESSION_SECRET',
    process.env.SESSION_SECRET,
    'dev-session-secret-change-me',
  );

  // Cross-site (web + api on different Vercel domains) needs SameSite=None; Secure
  const crossSite = Boolean(process.env.WEB_ORIGIN?.includes('vercel.app'));

  app.use(
    session({
      name: 'timeblock.sid',
      secret: sessionSecret,
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

  // Only serve a co-located SPA when not on Vercel (local/single-host prod)
  const serveWeb =
    isProd &&
    !isVercelRuntime() &&
    process.env.SERVE_WEB !== 'false';
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

  await app.init();
  return server;
}
