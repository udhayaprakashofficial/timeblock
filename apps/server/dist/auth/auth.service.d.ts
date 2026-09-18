import { CalendarProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
export declare class AuthService {
    private readonly prisma;
    private readonly crypto;
    private readonly supabase?;
    constructor(prisma: PrismaService, crypto: CryptoService, supabase?: SupabaseRestService | undefined);
    upsertOAuthUser(input: {
        provider: CalendarProvider;
        providerAccountId: string;
        email: string;
        name: string;
        accessToken: string;
        refreshToken?: string;
        expiresAt?: Date;
        scope?: string;
        /** If already logged in, attach this calendar to the current user */
        linkToUserId?: string;
    }): Promise<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
        createdAt: Date;
        updatedAt: Date;
        passwordHash: string | null;
        clerkId: string | null;
        defaultTaskMinutes: number;
    }>;
    getDecryptedTokens(userId: string, provider: CalendarProvider): Promise<{
        accessToken: string;
        refreshToken: string | null;
        expiresAt: Date | null;
        accountId: string;
    } | null>;
    updateTokens(accountId: string, accessToken: string, refreshToken?: string | null, expiresAt?: Date | null): Promise<void>;
}
