import session = require('express-session');
type Callback = (err?: unknown, sessionData?: session.SessionData | null) => void;
/**
 * File-backed session store used when Postgres is unreachable.
 * Survives Nest restarts (unlike MemoryStore).
 */
export declare class FileSessionStore extends session.Store {
    private readonly dir;
    private readonly file;
    private read;
    private write;
    get(sid: string, callback: Callback): void;
    set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void;
    destroy(sid: string, callback?: (err?: unknown) => void): void;
    touch(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void;
}
export {};
