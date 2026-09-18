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
exports.MicrosoftStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_microsoft_1 = require("passport-microsoft");
const client_1 = require("@prisma/client");
const auth_service_1 = require("./auth.service");
let MicrosoftStrategy = class MicrosoftStrategy extends (0, passport_1.PassportStrategy)(passport_microsoft_1.Strategy, 'microsoft') {
    authService;
    constructor(authService) {
        super({
            clientID: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            callbackURL: process.env.MICROSOFT_CALLBACK_URL ??
                'http://localhost:3001/api/auth/microsoft/callback',
            scope: ['user.read', 'calendars.read', 'offline_access'],
            tenant: process.env.MICROSOFT_TENANT_ID ?? 'common',
            passReqToCallback: true,
        });
        this.authService = authService;
    }
    async validate(req, accessToken, refreshToken, profile) {
        const email = profile.emails?.[0]?.value ||
            profile._json?.mail ||
            profile._json?.userPrincipalName;
        if (!email) {
            throw new Error('Microsoft profile missing email');
        }
        return this.authService.upsertOAuthUser({
            provider: client_1.CalendarProvider.microsoft,
            providerAccountId: profile.id,
            email,
            name: profile.displayName || email,
            accessToken,
            refreshToken,
            scope: 'user.read calendars.read offline_access',
            linkToUserId: req.session?.userId,
        });
    }
};
exports.MicrosoftStrategy = MicrosoftStrategy;
exports.MicrosoftStrategy = MicrosoftStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], MicrosoftStrategy);
//# sourceMappingURL=microsoft.strategy.js.map