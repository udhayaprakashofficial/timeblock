import session = require('express-session');
import { PrismaClient } from '@prisma/client';
type Callback = (err?: unknown, session?: session.SessionData | null) => void;
/**
 * Persists express-session in the app DB (tied to User when logged in).
 */
export declare class PrismaSessionStore extends session.Store {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    get(sid: string, callback: Callback): void;
    set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void;
    destroy(sid: string, callback?: (err?: unknown) => void): void;
    touch(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void;
}
export {};
