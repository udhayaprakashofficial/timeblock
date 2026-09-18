"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleOAuthRegistrar = void 0;
const common_1 = require("@nestjs/common");
const passport = require("passport");
const passport_google_oauth20_1 = require("passport-google-oauth20");
const client_1 = require("@prisma/client");
const fs_1 = require("fs");
const path_1 = require("path");
const auth_service_1 = require("./auth.service");
/**
 * Registers / hot-reloads the Passport Google strategy from env (or UI setup).
 */
let GoogleOAuthRegistrar = class GoogleOAuthRegistrar {
    authService;
    constructor(authService) {
        this.authService = authService;
    }
    onModuleInit() {
        this.registerFromEnv();
    }
    isConfigured() {
        return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() &&
            process.env.GOOGLE_CLIENT_SECRET?.trim());
    }
    registerFromEnv() {
        this.register(process.env.GOOGLE_CLIENT_ID?.trim() ?? '', process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '');
    }
    register(clientID, clientSecret) {
        const callbackURL = process.env.GOOGLE_CALLBACK_URL?.trim() ||
            'http://localhost:3001/api/auth/google/callback';
        // Passport requires non-empty strings; real values checked at request time
        const id = clientID || 'not-configured';
        const secret = clientSecret || 'not-configured';
        try {
            passport.unuse('google');
        }
        catch {
            // strategy may not exist yet
        }
        const verify = async (req, accessToken, refreshToken, profile, done) => {
            if (!process.env.GOOGLE_CLIENT_ID?.trim() ||
                !process.env.GOOGLE_CLIENT_SECRET?.trim()) {
                return done(new Error('Google OAuth is not configured'));
            }
            const email = profile.emails?.[0]?.value;
            if (!email) {
                return done(new Error('Google profile missing email'));
            }
            try {
                const user = await this.authService.upsertOAuthUser({
                    provider: client_1.CalendarProvider.google,
                    providerAccountId: profile.id,
                    email,
                    name: profile.displayName || email,
                    accessToken,
                    refreshToken,
                    scope: 'calendar.readonly email profile',
                    linkToUserId: req.session?.userId,
                });
                done(null, user);
            }
            catch (err) {
                done(err);
            }
        };
        passport.use('google', new passport_google_oauth20_1.Strategy({
            clientID: id,
            clientSecret: secret,
            callbackURL,
            passReqToCallback: true,
            scope: [
                'email',
                'profile',
                'https://www.googleapis.com/auth/calendar.readonly',
            ],
        }, verify));
        console.log(`[auth] Google OAuth ${clientID && clientSecret ? 'enabled' : 'waiting for credentials'}`);
    }
    /** Persist credentials to .env and hot-reload the Passport strategy (no restart). */
    saveCredentials(clientId, clientSecret) {
        const id = clientId.trim();
        const secret = clientSecret.trim();
        if (!id || !secret) {
            throw new Error('Client ID and Client Secret are required');
        }
        if (!id.includes('.apps.googleusercontent.com') && !id.includes('google')) {
            // soft check — Google client IDs usually end with this
        }
        const envPaths = [
            (0, path_1.resolve)(__dirname, '../../.env'),
            (0, path_1.resolve)(__dirname, '../../../../.env'),
        ];
        for (const envPath of envPaths) {
            if (!(0, fs_1.existsSync)(envPath))
                continue;
            let content = (0, fs_1.readFileSync)(envPath, 'utf8');
            content = upsertEnv(content, 'GOOGLE_CLIENT_ID', id);
            content = upsertEnv(content, 'GOOGLE_CLIENT_SECRET', secret);
            content = upsertEnv(content, 'GOOGLE_CALLBACK_URL', process.env.GOOGLE_CALLBACK_URL?.trim() ||
                'http://localhost:3001/api/auth/google/callback');
            (0, fs_1.writeFileSync)(envPath, content, 'utf8');
        }
        process.env.GOOGLE_CLIENT_ID = id;
        process.env.GOOGLE_CLIENT_SECRET = secret;
        process.env.GOOGLE_CALLBACK_URL =
            process.env.GOOGLE_CALLBACK_URL?.trim() ||
                'http://localhost:3001/api/auth/google/callback';
        this.register(id, secret);
        return { ok: true, googleConfigured: true };
    }
};
exports.GoogleOAuthRegistrar = GoogleOAuthRegistrar;
exports.GoogleOAuthRegistrar = GoogleOAuthRegistrar = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], GoogleOAuthRegistrar);
function upsertEnv(content, key, value) {
    const line = `${key}="${value}"`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) {
        return content.replace(re, line);
    }
    return `${content.trimEnd()}\n${line}\n`;
}
//# sourceMappingURL=google-oauth.registrar.js.map