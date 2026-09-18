/**
 * Load env before Nest modules evaluate OAuth provider registration.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

loadEnv({ path: resolve(__dirname, '../.env'), override: true });
loadEnv({ path: resolve(__dirname, '../../../.env'), override: false });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser = require('cookie-parser');
import session = require('express-session');
import express = require('express');
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

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Required so secure cookies / proto work correctly behind proxies
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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
        sameSite: 'lax',
        secure: isProd,
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

  // Production: serve the Vite build from the same origin as /api
  if (isProd) {
    const webDist = resolve(__dirname, '../../web/dist');
    if (!existsSync(webDist)) {
      throw new Error(
        `[prod] Missing web build at ${webDist}. Run: npm run build -w @timeblock/web`,
      );
    }
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(webDist, { index: false }));
    expressApp.get(
      '*',
      (
        req: { path: string },
        res: { sendFile: (p: string) => void },
        next: () => void,
      ) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(join(webDist, 'index.html'));
      },
    );
    console.log(`[prod] Serving web from ${webDist}`);
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
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
    console.log(`App (SPA + API): http://localhost:${port}`);
  }
}

bootstrap();
