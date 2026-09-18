import { PrismaService } from '../prisma/prisma.service';
export declare class ClerkAuthService {
    private readonly prisma;
    private clerk;
    constructor(prisma: PrismaService);
    isConfigured(): boolean;
    /**
     * Verify Clerk session JWT, upsert local User, return app user id.
     * End users only sign in with Google — they never handle OAuth secrets.
     */
    syncFromToken(token: string): Promise<{
        id: string;
    }>;
}
