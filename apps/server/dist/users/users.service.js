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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const local_user_store_1 = require("../auth/local-user.store");
const local_data_store_1 = require("../auth/local-data.store");
const auth_service_1 = require("../auth/auth.service");
const supabase_rest_service_1 = require("../supabase/supabase-rest.service");
const crypto_service_1 = require("../crypto/crypto.service");
const create_id_1 = require("../supabase/create-id");
const time_util_1 = require("../common/time.util");
let UsersService = class UsersService {
    prisma;
    localUsers;
    localData;
    supabase;
    crypto;
    authService;
    constructor(prisma, localUsers, localData, supabase, crypto, authService) {
        this.prisma = prisma;
        this.localUsers = localUsers;
        this.localData = localData;
        this.supabase = supabase;
        this.crypto = crypto;
        this.authService = authService;
    }
    authConfig() {
        const googleOAuth = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() &&
            process.env.GOOGLE_CLIENT_SECRET?.trim());
        const clerkOn = Boolean(process.env.CLERK_SECRET_KEY?.trim() &&
            process.env.CLERK_PUBLISHABLE_KEY?.trim());
        return {
            googleSignIn: googleOAuth || clerkOn,
            allowDevLogin: process.env.NODE_ENV !== 'production' &&
                process.env.ALLOW_DEV_LOGIN === 'true',
            googleCalendarOAuth: googleOAuth,
            googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
            microsoftConfigured: Boolean(process.env.MICROSOFT_CLIENT_ID?.trim() &&
                process.env.MICROSOFT_CLIENT_SECRET?.trim()),
            clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY?.trim() || null,
        };
    }
    async getMe(userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                include: { oauthAccounts: true },
            });
            if (!user)
                throw new common_1.NotFoundException('User not found');
            return this.toDto(user);
        }
        catch (err) {
            if (err instanceof common_1.NotFoundException)
                throw err;
            if (this.supabase.isConfigured()) {
                const user = await this.supabase.getUserById(userId);
                if (user) {
                    const providers = await this.supabase.listOAuthProviders(user.id);
                    return this.dtoFromParts(user, providers);
                }
                throw new common_1.NotFoundException('User not found');
            }
            throw err;
        }
    }
    /** Resolve IANA timezone for scheduling (falls back to UTC). */
    async getTimeZone(userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { timezone: true },
            });
            if (user?.timezone)
                return (0, time_util_1.normalizeTimeZone)(user.timezone);
        }
        catch {
            /* try REST */
        }
        if (this.supabase.isConfigured()) {
            const user = await this.supabase.getUserById(userId);
            if (user?.timezone)
                return (0, time_util_1.normalizeTimeZone)(user.timezone);
        }
        return 'UTC';
    }
    /**
     * Browser Google Identity Services login (token obtained in the browser).
     * Uses Supabase when reachable; otherwise a local file store.
     */
    async loginWithGoogleBrowser(input) {
        const email = input.email.trim().toLowerCase();
        const name = input.name.trim() || email;
        const googleId = input.googleId.trim();
        const accessToken = input.accessToken.trim();
        if (!email || !googleId || !accessToken) {
            throw new common_1.BadRequestException('Missing Google profile or access token');
        }
        const viaRest = async () => {
            if (!this.supabase.isConfigured())
                throw new Error('REST not configured');
            await this.supabase.ping();
            const user = await this.supabase.upsertGoogleUser({
                email,
                name,
                googleId,
                accessTokenEncrypted: this.crypto.encrypt(accessToken),
                refreshTokenEncrypted: input.refreshToken
                    ? this.crypto.encrypt(input.refreshToken)
                    : null,
            });
            const providers = await this.supabase.listOAuthProviders(user.id);
            try {
                await this.seedDefaultScheduleRest(user.id);
            }
            catch (e) {
                console.warn('[auth] schedule seed via REST failed', e);
            }
            return this.dtoFromParts(user, providers);
        };
        // Prefer Supabase HTTPS REST when keys are set (works without Postgres :5432)
        if (this.supabase.isConfigured()) {
            try {
                return await viaRest();
            }
            catch (restErr) {
                console.warn('[auth] Supabase REST failed — trying Prisma', restErr instanceof Error ? restErr.message : restErr);
            }
        }
        try {
            const user = await this.authService.upsertOAuthUser({
                provider: client_1.CalendarProvider.google,
                providerAccountId: googleId,
                email,
                name,
                accessToken,
                refreshToken: input.refreshToken,
                scope: 'calendar.readonly email profile',
            });
            return this.getMe(user.id);
        }
        catch (err) {
            console.error('[auth] Google login failed against Supabase', err instanceof Error ? err.message : err);
            throw new common_1.BadRequestException('Could not save account to Supabase. Check DATABASE_URL / SUPABASE keys.');
        }
    }
    async updateProfile(userId, body) {
        const tz = body.timezone !== undefined
            ? (0, time_util_1.normalizeTimeZone)(body.timezone)
            : undefined;
        let defaultTaskMinutes;
        if (body.defaultTaskMinutes !== undefined) {
            const n = Number(body.defaultTaskMinutes);
            if (!Number.isFinite(n) || n < 5 || n > 8 * 60) {
                throw new common_1.BadRequestException('Default task duration must be between 5 and 480 minutes');
            }
            defaultTaskMinutes = Math.round(n);
        }
        if (!body.name &&
            !body.email &&
            !body.theme &&
            tz === undefined &&
            defaultTaskMinutes === undefined) {
            throw new common_1.BadRequestException('Nothing to update');
        }
        if (body.theme && body.theme !== 'light' && body.theme !== 'dark') {
            throw new common_1.BadRequestException('Invalid theme');
        }
        if (body.email) {
            const taken = await this.prisma.user.findFirst({
                where: { email: body.email, NOT: { id: userId } },
            });
            if (taken)
                throw new common_1.BadRequestException('Email already in use');
        }
        const data = {
            ...(body.name ? { name: body.name.trim() } : {}),
            ...(body.email ? { email: body.email.trim().toLowerCase() } : {}),
            ...(body.theme ? { theme: body.theme } : {}),
            ...(tz !== undefined ? { timezone: tz } : {}),
            ...(defaultTaskMinutes !== undefined ? { defaultTaskMinutes } : {}),
        };
        try {
            await this.prisma.user.update({
                where: { id: userId },
                data,
            });
            return this.getMe(userId);
        }
        catch (err) {
            if (this.supabase.isConfigured()) {
                await this.supabase.patch('User', `id=eq.${userId}`, {
                    ...data,
                    updatedAt: new Date().toISOString(),
                });
                return this.getMe(userId);
            }
            throw err;
        }
    }
    async seedDefaultScheduleRest(userId) {
        const existing = await this.supabase.select('DailyScheduleTemplate', 'id', {
            filter: `userId=eq.${userId}`,
            limit: 1,
        });
        if (existing.length)
            return;
        const now = new Date().toISOString();
        for (const weekday of [1, 2, 3, 4, 5]) {
            const templateId = (0, create_id_1.createId)();
            await this.supabase.insert('DailyScheduleTemplate', {
                id: templateId,
                userId,
                weekday,
                workStart: '09:00',
                workEnd: '18:00',
                createdAt: now,
                updatedAt: now,
            });
            await this.supabase.insert('Break', {
                id: (0, create_id_1.createId)(),
                templateId,
                name: 'Lunch',
                start: '12:00',
                end: '13:00',
            });
        }
    }
    async signupWithPassword(input) {
        const email = input.email.trim().toLowerCase();
        const password = input.password;
        const name = (input.name?.trim() || email.split('@')[0] || 'User').slice(0, 80);
        if (!email || !email.includes('@')) {
            throw new common_1.BadRequestException('Valid email is required');
        }
        if (!password || password.length < 6) {
            throw new common_1.BadRequestException('Password must be at least 6 characters');
        }
        const passwordHash = this.crypto.hashPassword(password);
        if (this.supabase.isConfigured()) {
            try {
                await this.supabase.ping();
                const existing = await this.supabase.getUserByEmail(email);
                if (existing) {
                    throw new common_1.BadRequestException('An account with this email already exists');
                }
                const user = await this.supabase.createPasswordUser({
                    email,
                    name,
                    passwordHash,
                });
                try {
                    await this.seedDefaultScheduleRest(user.id);
                }
                catch {
                    /* optional */
                }
                return this.dtoFromParts(user, []);
            }
            catch (err) {
                if (err instanceof common_1.BadRequestException)
                    throw err;
                console.warn('[auth] signup REST failed', err instanceof Error ? err.message : err);
            }
        }
        try {
            const taken = await this.prisma.user.findUnique({ where: { email } });
            if (taken) {
                throw new common_1.BadRequestException('An account with this email already exists');
            }
            const user = await this.prisma.user.create({
                data: { email, name, passwordHash },
                include: { oauthAccounts: true },
            });
            return this.toDto(user);
        }
        catch (err) {
            if (err instanceof common_1.BadRequestException)
                throw err;
            console.error('[auth] signup failed against Supabase', err instanceof Error ? err.message : err);
            throw new common_1.BadRequestException('Could not create account in Supabase. Check DATABASE_URL / SUPABASE keys.');
        }
    }
    async signinWithPassword(input) {
        const email = input.email.trim().toLowerCase();
        const password = input.password;
        if (!email || !password) {
            throw new common_1.BadRequestException('Email and password are required');
        }
        if (this.supabase.isConfigured()) {
            try {
                await this.supabase.ping();
                const user = await this.supabase.getUserByEmail(email);
                if (user?.passwordHash && this.crypto.verifyPassword(password, user.passwordHash)) {
                    const providers = await this.supabase.listOAuthProviders(user.id);
                    return this.dtoFromParts(user, providers);
                }
                if (user && !user.passwordHash) {
                    throw new common_1.BadRequestException('This account uses Google sign-in. Continue with Google.');
                }
                if (user) {
                    throw new common_1.BadRequestException('Invalid email or password');
                }
            }
            catch (err) {
                if (err instanceof common_1.BadRequestException)
                    throw err;
                console.warn('[auth] signin REST failed', err instanceof Error ? err.message : err);
            }
        }
        try {
            const user = await this.prisma.user.findUnique({
                where: { email },
                include: { oauthAccounts: true },
            });
            if (user?.passwordHash && this.crypto.verifyPassword(password, user.passwordHash)) {
                return this.toDto(user);
            }
            if (user && !user.passwordHash) {
                throw new common_1.BadRequestException('This account uses Google sign-in. Continue with Google.');
            }
            if (user) {
                throw new common_1.BadRequestException('Invalid email or password');
            }
        }
        catch (err) {
            if (err instanceof common_1.BadRequestException)
                throw err;
        }
        throw new common_1.BadRequestException('Invalid email or password');
    }
    async ensureDevUser() {
        const email = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase();
        const name = process.env.DEV_LOGIN_NAME?.trim();
        if (!email || !name) {
            throw new common_1.BadRequestException('Set DEV_LOGIN_EMAIL and DEV_LOGIN_NAME in server .env for dev login');
        }
        let user = await this.prisma.user.findUnique({ where: { email } });
        if (!user) {
            user = await this.prisma.user.create({
                data: { email, name },
            });
        }
        return user;
    }
    dtoFromParts(user, providers) {
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            theme: user.theme === 'dark' ? 'dark' : 'light',
            timezone: (0, time_util_1.normalizeTimeZone)(user.timezone),
            defaultTaskMinutes: Number.isFinite(Number(user.defaultTaskMinutes)) &&
                Number(user.defaultTaskMinutes) >= 5
                ? Math.round(Number(user.defaultTaskMinutes))
                : 30,
            connectedProviders: providers,
        };
    }
    toDto(user) {
        return this.dtoFromParts(user, user.oauthAccounts.map((a) => a.provider));
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(5, (0, common_1.Inject)((0, common_1.forwardRef)(() => auth_service_1.AuthService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        local_user_store_1.LocalUserStore,
        local_data_store_1.LocalDataStore,
        supabase_rest_service_1.SupabaseRestService,
        crypto_service_1.CryptoService,
        auth_service_1.AuthService])
], UsersService);
//# sourceMappingURL=users.service.js.map