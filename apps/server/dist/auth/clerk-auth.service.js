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
exports.ClerkAuthService = void 0;
const backend_1 = require("@clerk/backend");
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ClerkAuthService = class ClerkAuthService {
    prisma;
    clerk = (0, backend_1.createClerkClient)({
        secretKey: process.env.CLERK_SECRET_KEY ?? '',
    });
    constructor(prisma) {
        this.prisma = prisma;
    }
    isConfigured() {
        return Boolean(process.env.CLERK_SECRET_KEY?.trim() &&
            process.env.CLERK_PUBLISHABLE_KEY?.trim());
    }
    /**
     * Verify Clerk session JWT, upsert local User, return app user id.
     * End users only sign in with Google — they never handle OAuth secrets.
     */
    async syncFromToken(token) {
        if (!this.isConfigured()) {
            throw new common_1.UnauthorizedException('Clerk auth is not configured');
        }
        let clerkUserId;
        try {
            const payload = await (0, backend_1.verifyToken)(token, {
                secretKey: process.env.CLERK_SECRET_KEY,
            });
            clerkUserId = payload.sub;
        }
        catch {
            throw new common_1.UnauthorizedException('Invalid Clerk session');
        }
        const clerkUser = await this.clerk.users.getUser(clerkUserId);
        const email = clerkUser.primaryEmailAddress?.emailAddress ??
            clerkUser.emailAddresses[0]?.emailAddress;
        if (!email) {
            throw new common_1.UnauthorizedException('Google account has no email');
        }
        const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') ||
            clerkUser.fullName ||
            email;
        const existingByClerk = await this.prisma.user.findUnique({
            where: { clerkId: clerkUserId },
        });
        if (existingByClerk) {
            await this.prisma.user.update({
                where: { id: existingByClerk.id },
                data: { name, email: email.toLowerCase() },
            });
            return existingByClerk;
        }
        const existingByEmail = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });
        if (existingByEmail) {
            return this.prisma.user.update({
                where: { id: existingByEmail.id },
                data: { clerkId: clerkUserId, name },
            });
        }
        return this.prisma.user.create({
            data: {
                clerkId: clerkUserId,
                email: email.toLowerCase(),
                name,
            },
        });
    }
};
exports.ClerkAuthService = ClerkAuthService;
exports.ClerkAuthService = ClerkAuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ClerkAuthService);
//# sourceMappingURL=clerk-auth.service.js.map