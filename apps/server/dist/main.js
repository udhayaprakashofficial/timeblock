"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Load env before Nest modules evaluate OAuth provider registration.
 */
const dotenv_1 = require("dotenv");
const fs_1 = require("fs");
const path_1 = require("path");
(0, dotenv_1.config)({ path: (0, path_1.resolve)(__dirname, '../.env'), override: true });
(0, dotenv_1.config)({ path: (0, path_1.resolve)(__dirname, '../../../.env'), override: false });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const express = require("express");
const client_1 = require("@prisma/client");
const app_module_1 = require("./app.module");
const prisma_session_store_1 = require("./auth/prisma-session.store");
function requireProdSecret(name, value, fallback) {
    const v = value?.trim();
    if (process.env.NODE_ENV === 'production') {
        if (!v || v === fallback) {
            throw new Error(`[prod] ${name} must be set to a strong random value (e.g. openssl rand -base64 48)`);
        }
        return v;
    }
    return v || fallback;
}
async function bootstrap() {
    const isProd = process.env.NODE_ENV === 'production';
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    // Required so secure cookies / proto work correctly behind proxies
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.use(cookieParser());
    let sessionStore;
    try {
        const sessionPrisma = new client_1.PrismaClient();
        await sessionPrisma.$connect();
        sessionStore = new prisma_session_store_1.PrismaSessionStore(sessionPrisma);
        console.log('[session] Using Postgres session store (Supabase)');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[session] DATABASE_URL unreachable:', msg);
        throw new Error('DATABASE_URL must reach Supabase Postgres (db.<project>.supabase.co:5432). File sessions are disabled.');
    }
    const sessionSecret = requireProdSecret('SESSION_SECRET', process.env.SESSION_SECRET, 'dev-session-secret-change-me');
    app.use(session({
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
    }));
    const allowedOrigins = new Set((process.env.WEB_ORIGIN ?? 'http://localhost:5173')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean));
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
        origin: (requestOrigin, cb) => {
            if (!requestOrigin || allowedOrigins.has(requestOrigin)) {
                return cb(null, true);
            }
            return cb(null, false);
        },
        credentials: true,
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
    }));
    // Production: serve the Vite build from the same origin as /api
    if (isProd) {
        const webDist = (0, path_1.resolve)(__dirname, '../../web/dist');
        if (!(0, fs_1.existsSync)(webDist)) {
            throw new Error(`[prod] Missing web build at ${webDist}. Run: npm run build -w @timeblock/web`);
        }
        const expressApp = app.getHttpAdapter().getInstance();
        expressApp.use(express.static(webDist, { index: false }));
        expressApp.get('*', (req, res, next) => {
            if (req.path.startsWith('/api'))
                return next();
            res.sendFile((0, path_1.join)(webDist, 'index.html'));
        });
        console.log(`[prod] Serving web from ${webDist}`);
    }
    const port = Number(process.env.PORT ?? 3001);
    await app.listen(port);
    const googleOn = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() &&
        process.env.GOOGLE_CLIENT_SECRET?.trim());
    console.log(`API listening on http://localhost:${port}`);
    console.log(`Google signup: ${googleOn
        ? 'enabled'
        : 'DISABLED — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in apps/server/.env'}`);
    if (isProd) {
        console.log(`App (SPA + API): http://localhost:${port}`);
    }
}
bootstrap();
//# sourceMappingURL=main.js.map