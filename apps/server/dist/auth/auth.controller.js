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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const passport = require("passport");
const clerk_auth_service_1 = require("./clerk-auth.service");
const google_oauth_registrar_1 = require("./google-oauth.registrar");
const login_code_service_1 = require("./login-code.service");
const users_service_1 = require("../users/users.service");
const calendar_sync_service_1 = require("../calendar/calendar-sync.service");
function primaryWebOrigin(req) {
    const allowed = (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    // Prefer localhost:5173 for local Google GIS / cookies
    const preferred = 'http://localhost:5173';
    const fallback = allowed.includes(preferred)
        ? preferred
        : (allowed[0] ?? preferred);
    // Prefer the origin the user started from (so post-login lands on the same host)
    const candidates = [
        req?.session?.oauthWebOrigin,
        typeof req?.headers?.origin === 'string' ? req.headers.origin : null,
        (() => {
            const ref = req?.headers?.referer;
            if (!ref || typeof ref !== 'string')
                return null;
            try {
                return new URL(ref).origin;
            }
            catch {
                return null;
            }
        })(),
    ].filter(Boolean);
    for (const c of candidates) {
        if (allowed.includes(c))
            return c;
    }
    return fallback;
}
function safeReturnPath(raw, fallback = '/') {
    if (!raw || !raw.startsWith('/') || raw.startsWith('//'))
        return fallback;
    // Always land on dashboard after auth — drop auth UI query flags
    try {
        const u = new URL(raw, 'http://local');
        u.searchParams.delete('mode');
        u.searchParams.delete('authError');
        u.searchParams.delete('loginCode');
        const path = u.pathname + u.search;
        return path === '' ? '/' : path;
    }
    catch {
        return fallback;
    }
}
function setSessionUser(req, _res, userId, onDone) {
    const finish = (err) => onDone(err);
    // Prefer in-place update — regenerate can race with the next /me after signup
    if (req.session) {
        req.session.userId = userId;
        req.session.save((err) => finish(err ?? undefined));
        return;
    }
    finish(new Error('No session'));
}
let AuthController = class AuthController {
    clerkAuth;
    googleOAuth;
    usersService;
    loginCodes;
    calendarSync;
    constructor(clerkAuth, googleOAuth, usersService, loginCodes, calendarSync) {
        this.clerkAuth = clerkAuth;
        this.googleOAuth = googleOAuth;
        this.usersService = usersService;
        this.loginCodes = loginCodes;
        this.calendarSync = calendarSync;
    }
    /**
     * Exchange Clerk session (after Google sign-in) for an app DB session.
     */
    async clerkLogin(req, res, body) {
        const token = body.token?.trim();
        if (!token) {
            return res.status(400).json({ error: 'Missing Clerk token' });
        }
        try {
            const user = await this.clerkAuth.syncFromToken(token);
            setSessionUser(req, res, user.id, async (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to save session' });
                }
                const me = await this.usersService.getMe(user.id);
                return res.json(me);
            });
        }
        catch (e) {
            return res.status(401).json({
                error: e instanceof Error ? e.message : 'Clerk login failed',
            });
        }
    }
    /**
     * Browser Google Identity Services: access token + profile from the browser
     * (avoids server-side token exchange when the API cannot reach Google).
     */
    async googleBrowser(req, res, body) {
        try {
            const me = await this.usersService.loginWithGoogleBrowser({
                accessToken: body.accessToken ?? '',
                refreshToken: body.refreshToken,
                email: body.email ?? '',
                name: body.name ?? '',
                googleId: body.googleId ?? '',
            });
            setSessionUser(req, res, me.id, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to save session' });
                }
                if (!me.id.startsWith('local_')) {
                    void this.calendarSync.syncNow(me.id).catch(() => undefined);
                }
                return res.json(me);
            });
        }
        catch (e) {
            return res.status(401).json({
                error: e instanceof Error ? e.message : 'Google browser login failed',
            });
        }
    }
    async signup(req, res, body) {
        try {
            const me = await this.usersService.signupWithPassword({
                email: body.email ?? '',
                password: body.password ?? '',
                name: body.name,
            });
            setSessionUser(req, res, me.id, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to save session' });
                }
                return res.json(me);
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Sign up failed';
            const status = msg.includes('already exists') || msg.includes('required') || msg.includes('characters')
                ? 400
                : 500;
            return res.status(status).json({ error: msg });
        }
    }
    async signin(req, res, body) {
        try {
            const me = await this.usersService.signinWithPassword({
                email: body.email ?? '',
                password: body.password ?? '',
            });
            setSessionUser(req, res, me.id, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to save session' });
                }
                return res.json(me);
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Sign in failed';
            return res.status(401).json({ error: msg });
        }
    }
    /**
     * Finish Google OAuth: one-time code → session cookie via Vite proxy → dashboard.
     */
    exchange(req, res, body) {
        const code = body.code?.trim();
        if (!code) {
            return res.status(400).json({ error: 'Missing login code' });
        }
        const userId = this.loginCodes.resolve(code);
        if (!userId) {
            return res.status(401).json({ error: 'Invalid or expired login code' });
        }
        setSessionUser(req, res, userId, async (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to save session' });
            }
            try {
                const me = await this.usersService.getMe(userId);
                this.loginCodes.invalidate(code);
                void this.calendarSync.syncNow(userId).catch(() => undefined);
                return res.json(me);
            }
            catch (e) {
                return res.status(500).json({
                    error: e instanceof Error ? e.message : 'Failed to load user',
                });
            }
        });
    }
    googleAuth(req, res, next, returnTo) {
        if (!this.googleOAuth.isConfigured()) {
            return res.redirect(`${primaryWebOrigin(req)}/?authError=google_not_configured`);
        }
        // Always return to dashboard after Google sign-in
        req.session.oauthReturnTo = '/';
        const originHeader = req.headers.origin;
        if (typeof originHeader === 'string' && originHeader) {
            req.session.oauthWebOrigin = originHeader;
        }
        else if (typeof req.headers.referer === 'string') {
            try {
                req.session.oauthWebOrigin = new URL(req.headers.referer).origin;
            }
            catch {
                /* ignore */
            }
        }
        void returnTo; // dashboard only
        req.session.save((err) => {
            if (err) {
                return res.redirect(`${primaryWebOrigin(req)}/?authError=session`);
            }
            passport.authenticate('google', {
                session: false,
                scope: [
                    'email',
                    'profile',
                    'https://www.googleapis.com/auth/calendar.readonly',
                ],
                accessType: 'offline',
                prompt: 'consent',
            })(req, res, next);
        });
    }
    googleCallback(req, res, next) {
        passport.authenticate('google', { session: false }, (err, user, _info) => {
            const web = primaryWebOrigin(req);
            if (err || !user || !user.id) {
                console.error('[auth/google] callback failed', err?.message ?? _info);
                // Common when this host cannot reach oauth2.googleapis.com for token exchange
                const reason = err?.message?.includes('access token') ||
                    String(_info ?? '').includes('access token')
                    ? 'google_token'
                    : 'google';
                return res.redirect(`${web}/?authError=${reason}`);
            }
            const code = this.loginCodes.issue(user.id);
            // Dashboard only
            res.redirect(`${web}/?loginCode=${encodeURIComponent(code)}`);
        })(req, res, next);
    }
    microsoftAuth(req, res, next, returnTo) {
        if (!process.env.MICROSOFT_CLIENT_ID?.trim() ||
            !process.env.MICROSOFT_CLIENT_SECRET?.trim()) {
            return res.redirect(`${primaryWebOrigin(req)}/?authError=microsoft_not_configured`);
        }
        req.session.oauthReturnTo = safeReturnPath(returnTo, '/');
        if (typeof req.headers.referer === 'string') {
            try {
                req.session.oauthWebOrigin = new URL(req.headers.referer).origin;
            }
            catch {
                /* ignore */
            }
        }
        req.session.save((err) => {
            if (err) {
                return res.redirect(`${primaryWebOrigin(req)}/?authError=session`);
            }
            passport.authenticate('microsoft', { session: false })(req, res, next);
        });
    }
    microsoftCallback(req, res, next) {
        passport.authenticate('microsoft', { session: false }, (err, user, _info) => {
            const web = primaryWebOrigin(req);
            if (err || !user || !user.id) {
                return res.redirect(`${web}/?authError=microsoft`);
            }
            const returnPath = safeReturnPath(req.session.oauthReturnTo, '/');
            const code = this.loginCodes.issue(user.id);
            const sep = returnPath.includes('?') ? '&' : '?';
            res.redirect(`${web}${returnPath}${sep}loginCode=${encodeURIComponent(code)}`);
        })(req, res, next);
    }
    logout(req, res) {
        req.session.destroy(() => {
            res.clearCookie('timeblock.sid');
            res.json({ ok: true });
        });
    }
    session(req) {
        return {
            authenticated: Boolean(req.session.userId),
            userId: req.session.userId ?? null,
        };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('clerk'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "clerkLogin", null);
__decorate([
    (0, common_1.Post)('google/browser'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "googleBrowser", null);
__decorate([
    (0, common_1.Post)('signup'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "signup", null);
__decorate([
    (0, common_1.Post)('signin'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "signin", null);
__decorate([
    (0, common_1.Post)('exchange'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "exchange", null);
__decorate([
    (0, common_1.Get)('google'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Next)()),
    __param(3, (0, common_1.Query)('returnTo')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Function, String]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "googleAuth", null);
__decorate([
    (0, common_1.Get)('google/callback'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Next)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Function]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "googleCallback", null);
__decorate([
    (0, common_1.Get)('microsoft'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Next)()),
    __param(3, (0, common_1.Query)('returnTo')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Function, String]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "microsoftAuth", null);
__decorate([
    (0, common_1.Get)('microsoft/callback'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Next)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Function]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "microsoftCallback", null);
__decorate([
    (0, common_1.Post)('logout'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)('session'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "session", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => calendar_sync_service_1.CalendarSyncService))),
    __metadata("design:paramtypes", [clerk_auth_service_1.ClerkAuthService,
        google_oauth_registrar_1.GoogleOAuthRegistrar,
        users_service_1.UsersService,
        login_code_service_1.LoginCodeService,
        calendar_sync_service_1.CalendarSyncService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map