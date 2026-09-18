import type { Request, Response } from 'express';
import type { ThemePreference } from '@timeblock/shared-types';
import { UsersService } from './users.service';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    authConfig(): import("@timeblock/shared-types").AuthConfigDto;
    /** Soft auth check — returns JSON `null` (200) when logged out instead of 401. */
    me(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    updateMe(req: Request, res: Response, body: {
        name?: string;
        email?: string;
        theme?: ThemePreference;
        timezone?: string;
        defaultTaskMinutes?: number;
    }): Promise<Response<any, Record<string, any>>>;
    devLogin(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
