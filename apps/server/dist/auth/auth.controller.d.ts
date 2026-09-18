import type { Request, Response, NextFunction } from 'express';
import { ClerkAuthService } from './clerk-auth.service';
import { GoogleOAuthRegistrar } from './google-oauth.registrar';
import { LoginCodeService } from './login-code.service';
import { UsersService } from '../users/users.service';
import { CalendarSyncService } from '../calendar/calendar-sync.service';
export declare class AuthController {
    private readonly clerkAuth;
    private readonly googleOAuth;
    private readonly usersService;
    private readonly loginCodes;
    private readonly calendarSync;
    constructor(clerkAuth: ClerkAuthService, googleOAuth: GoogleOAuthRegistrar, usersService: UsersService, loginCodes: LoginCodeService, calendarSync: CalendarSyncService);
    /**
     * Exchange Clerk session (after Google sign-in) for an app DB session.
     */
    clerkLogin(req: Request, res: Response, body: {
        token?: string;
    }): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * Browser Google Identity Services: access token + profile from the browser
     * (avoids server-side token exchange when the API cannot reach Google).
     */
    googleBrowser(req: Request, res: Response, body: {
        accessToken?: string;
        refreshToken?: string;
        email?: string;
        name?: string;
        googleId?: string;
    }): Promise<Response<any, Record<string, any>> | undefined>;
    signup(req: Request, res: Response, body: {
        email?: string;
        password?: string;
        name?: string;
    }): Promise<Response<any, Record<string, any>> | undefined>;
    signin(req: Request, res: Response, body: {
        email?: string;
        password?: string;
    }): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * Finish Google OAuth: one-time code → session cookie via Vite proxy → dashboard.
     */
    exchange(req: Request, res: Response, body: {
        code?: string;
    }): Response<any, Record<string, any>> | undefined;
    googleAuth(req: Request, res: Response, next: NextFunction, returnTo?: string): void;
    googleCallback(req: Request, res: Response, next: NextFunction): void;
    microsoftAuth(req: Request, res: Response, next: NextFunction, returnTo?: string): void;
    microsoftCallback(req: Request, res: Response, next: NextFunction): void;
    logout(req: Request, res: Response): void;
    session(req: Request): {
        authenticated: boolean;
        userId: string | null;
    };
}
