import type { AuthConfigDto, ThemePreference, UserDto } from "../shared-types/index.ts";
import { PrismaService } from '../prisma/prisma.service';
import { LocalUserStore } from '../auth/local-user.store';
import { LocalDataStore } from '../auth/local-data.store';
import { AuthService } from '../auth/auth.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { CryptoService } from '../crypto/crypto.service';
export declare class UsersService {
    private readonly prisma;
    private readonly localUsers;
    private readonly localData;
    private readonly supabase;
    private readonly crypto;
    private readonly authService;
    constructor(prisma: PrismaService, localUsers: LocalUserStore, localData: LocalDataStore, supabase: SupabaseRestService, crypto: CryptoService, authService: AuthService);
    authConfig(): AuthConfigDto;
    getMe(userId: string): Promise<UserDto>;
    /** Resolve IANA timezone for scheduling (falls back to UTC). */
    getTimeZone(userId: string): Promise<string>;
    /**
     * Browser Google Identity Services login (token obtained in the browser).
     * Uses Supabase when reachable; otherwise a local file store.
     */
    loginWithGoogleBrowser(input: {
        accessToken: string;
        refreshToken?: string;
        email: string;
        name: string;
        googleId: string;
    }): Promise<UserDto>;
    updateProfile(userId: string, body: {
        name?: string;
        email?: string;
        theme?: ThemePreference;
        timezone?: string;
        defaultTaskMinutes?: number;
    }): Promise<UserDto>;
    private seedDefaultScheduleRest;
    signupWithPassword(input: {
        email: string;
        password: string;
        name?: string;
    }): Promise<UserDto>;
    signinWithPassword(input: {
        email: string;
        password: string;
    }): Promise<UserDto>;
    ensureDevUser(): Promise<{
        id: string;
    }>;
    private dtoFromParts;
    private toDto;
}
