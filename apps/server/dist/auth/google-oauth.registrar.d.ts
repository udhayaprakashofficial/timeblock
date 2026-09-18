import { OnModuleInit } from '@nestjs/common';
import { AuthService } from './auth.service';
/**
 * Registers / hot-reloads the Passport Google strategy from env (or UI setup).
 */
export declare class GoogleOAuthRegistrar implements OnModuleInit {
    private readonly authService;
    constructor(authService: AuthService);
    onModuleInit(): void;
    isConfigured(): boolean;
    registerFromEnv(): void;
    register(clientID: string, clientSecret: string): void;
    /** Persist credentials to .env and hot-reload the Passport strategy (no restart). */
    saveCredentials(clientId: string, clientSecret: string): {
        ok: boolean;
        googleConfigured: boolean;
    };
}
