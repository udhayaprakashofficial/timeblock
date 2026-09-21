/**
 * Shared Nest bootstrap for local + Vercel (Fluid / Nest zero-config).
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

loadEnv({ path: resolve(__dirname, '../.env'), override: false });
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
import { SupabaseSessionStore } from './auth/supabase-session.store';
import { FileSessionStore } from './auth/file-session.store';

function isVercelRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

function sessionSecret(): string {
  const v = process.env.SESSION_SECRET?.trim();
  if (v) return v;
  if (isVercelRuntime()) {
    console.error(
      '[session] SESSION_SECRET is not set — using a stable temporary secret. Set SESSION_SECRET in Vercel env!',
    );
    // Must NOT include commit SHA — that invalidated every cookie on each deploy.
    return 'vercel-temp-timeblock-session-secret';
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[prod] SESSION_SECRET must be set (e.g. openssl rand -base64 48)',
    );
  }
  return 'dev-session-secret-change-me';
}

async function supabaseRestReachable(base: string, key: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${base}/rest/v1/User?select=id&limit=1`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok || res.status === 401 || res.status === 403;
  } catch {
    return false;
  }
}

async function createSessionStore(): Promise<session.Store> {
  const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    '';

  // On Vercel, prefer HTTPS PostgREST — direct Postgres often flakes after connect.
  if (isVercelRuntime() && base && key) {
    console.log('[session] Using Supabase REST session store (Vercel)');
    return new SupabaseSessionStore(base, key);
  }

  // Prefer Postgres when reachable (longer timeout — cold DNS is common).
  try {
    const sessionPrisma = new PrismaClient();
    await Promise.race([
      sessionPrisma.$connect().then(() => sessionPrisma.$queryRaw`SELECT 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('prisma connect timeout')), 12_000),
      ),
    ]);
    console.log('[session] Using Postgres session store (Prisma)');
    return new PrismaSessionStore(sessionPrisma);
  } catch (err) {
    console.warn(
      '[session] Prisma unreachable:',
      err instanceof Error ? err.message : String(err),
    );
  }

  if (base && key) {
    // Retry REST a few times before falling back — DB should stay primary.
    for (let attempt = 1; attempt <= 4; attempt++) {
      const ok = await supabaseRestReachable(base, key);
      if (ok) {
        console.log(
          `[session] Using Supabase REST session store (attempt ${attempt})`,
        );
        return new SupabaseSessionStore(base, key);
      }
      console.warn(`[session] Supabase REST attempt ${attempt}/4 failed`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    console.warn(
      '[session] Supabase REST still unreachable — temporary file session store',
    );
  }

  if (isVercelRuntime()) {
    console.error(
      '[session] No durable store on Vercel (set SUPABASE_URL + SUPABASE_SECRET_KEY). Falling back to MemoryStore — logins will 401 across cold starts.',
    );
    return new session.MemoryStore();
  }

  console.log('[session] Using file session store (local offline)');
  return new FileSessionStore();
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

  const sessionStore = await createSessionStore();

  // Cross-site cookies required: web and API are different Vercel hosts
  const crossSite =
    isVercelRuntime() ||
    Boolean(process.env.WEB_ORIGIN?.includes('vercel.app'));

  // Session cookie is first-party via Next.js /api rewrite to Nest.
  // SameSite=Lax — do NOT use None (third-party); browsers block those.
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
        sameSite: 'lax',
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
  // Always allow the production web hosts (+ previews)
  allowedOrigins.add('https://timeblock-web-ashy.vercel.app');
  allowedOrigins.add('https://app.cupkey.io');
  allowedOrigins.add('https://cupkey.io');
  allowedOrigins.add('https://www.cupkey.io');

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
      // Vercel preview / Cupkey hosts
      try {
        const host = new URL(requestOrigin).hostname;
        if (
          host === 'app.cupkey.io' ||
          host === 'cupkey.io' ||
          host.endsWith('.cupkey.io') ||
          host === 'timeblock-web-ashy.vercel.app' ||
          (host.endsWith('.vercel.app') && host.includes('timeblock'))
        ) {
          return cb(null, true);
        }
      } catch {
        /* ignore */
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
