import { Strategy } from 'passport-microsoft';
import type { Request } from 'express';
import { AuthService } from './auth.service';
type MsProfile = {
    id: string;
    displayName?: string;
    emails?: Array<{
        value: string;
    }>;
    _json?: {
        mail?: string;
        userPrincipalName?: string;
    };
};
declare const MicrosoftStrategy_base: new (options: import("passport-microsoft").MicrosoftStrategyOptions) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class MicrosoftStrategy extends MicrosoftStrategy_base {
    private readonly authService;
    constructor(authService: AuthService);
    validate(req: Request, accessToken: string, refreshToken: string, profile: MsProfile): Promise<{
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
}
export {};
