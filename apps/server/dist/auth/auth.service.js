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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const crypto_service_1 = require("../crypto/crypto.service");
const supabase_rest_service_1 = require("../supabase/supabase-rest.service");
let AuthService = class AuthService {
    prisma;
    crypto;
    supabase;
    constructor(prisma, crypto, supabase) {
        this.prisma = prisma;
        this.crypto = crypto;
        this.supabase = supabase;
    }
    async upsertOAuthUser(input) {
        const existingAccount = await this.prisma.oAuthAccount.findUnique({
            where: {
                provider_providerAccountId: {
                    provider: input.provider,
                    providerAccountId: input.providerAccountId,
                },
            },
        });
        let user = existingAccount &&
            (await this.prisma.user.findUnique({ where: { id: existingAccount.userId } }));
        // Prefer linking to the already-authenticated session user when connecting a second calendar
        if (!user && input.linkToUserId) {
            user = await this.prisma.user.findUnique({
                where: { id: input.linkToUserId },
            });
        }
        if (!user) {
            user = await this.prisma.user.findUnique({ where: { email: input.email } });
        }
        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    email: input.email,
                    name: input.name,
                },
            });
        }
        await this.prisma.oAuthAccount.upsert({
            where: {
                userId_provider: {
                    userId: user.id,
                    provider: input.provider,
                },
            },
            create: {
                userId: user.id,
                provider: input.provider,
                providerAccountId: input.providerAccountId,
                accessTokenEncrypted: this.crypto.encrypt(input.accessToken),
                refreshTokenEncrypted: input.refreshToken
                    ? this.crypto.encrypt(input.refreshToken)
                    : null,
                expiresAt: input.expiresAt,
                scope: input.scope,
            },
            update: {
                providerAccountId: input.providerAccountId,
                accessTokenEncrypted: this.crypto.encrypt(input.accessToken),
                refreshTokenEncrypted: input.refreshToken
                    ? this.crypto.encrypt(input.refreshToken)
                    : undefined,
                expiresAt: input.expiresAt,
                scope: input.scope,
            },
        });
        return user;
    }
    async getDecryptedTokens(userId, provider) {
        try {
            const account = await this.prisma.oAuthAccount.findUnique({
                where: { userId_provider: { userId, provider } },
            });
            if (account) {
                return {
                    accessToken: this.crypto.decrypt(account.accessTokenEncrypted),
                    refreshToken: account.refreshTokenEncrypted
                        ? this.crypto.decrypt(account.refreshTokenEncrypted)
                        : null,
                    expiresAt: account.expiresAt,
                    accountId: account.id,
                };
            }
        }
        catch {
            /* try REST */
        }
        if (this.supabase?.isConfigured()) {
            const account = await this.supabase.getOAuthAccount(userId, provider);
            if (!account)
                return null;
            return {
                accessToken: this.crypto.decrypt(account.accessTokenEncrypted),
                refreshToken: account.refreshTokenEncrypted
                    ? this.crypto.decrypt(account.refreshTokenEncrypted)
                    : null,
                expiresAt: account.expiresAt ? new Date(account.expiresAt) : null,
                accountId: account.id,
            };
        }
        return null;
    }
    async updateTokens(accountId, accessToken, refreshToken, expiresAt) {
        const data = {
            accessTokenEncrypted: this.crypto.encrypt(accessToken),
            ...(refreshToken
                ? { refreshTokenEncrypted: this.crypto.encrypt(refreshToken) }
                : {}),
            ...(expiresAt !== undefined
                ? { expiresAt: expiresAt?.toISOString?.() ?? expiresAt }
                : {}),
            updatedAt: new Date().toISOString(),
        };
        try {
            await this.prisma.oAuthAccount.update({
                where: { id: accountId },
                data: {
                    accessTokenEncrypted: data.accessTokenEncrypted,
                    ...(refreshToken
                        ? { refreshTokenEncrypted: this.crypto.encrypt(refreshToken) }
                        : {}),
                    ...(expiresAt !== undefined ? { expiresAt } : {}),
                },
            });
            return;
        }
        catch {
            /* REST */
        }
        if (this.supabase?.isConfigured()) {
            await this.supabase.patch('OAuthAccount', `id=eq.${accountId}`, {
                accessTokenEncrypted: data.accessTokenEncrypted,
                ...(refreshToken
                    ? { refreshTokenEncrypted: this.crypto.encrypt(refreshToken) }
                    : {}),
                ...(expiresAt !== undefined
                    ? { expiresAt: expiresAt ? expiresAt.toISOString() : null }
                    : {}),
                updatedAt: data.updatedAt,
            });
        }
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        crypto_service_1.CryptoService,
        supabase_rest_service_1.SupabaseRestService])
], AuthService);
//# sourceMappingURL=auth.service.js.map