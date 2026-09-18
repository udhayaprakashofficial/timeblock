/**
 * Short-lived login codes for Google OAuth handoff (:3001 → Vite :5173).
 * Codes are reusable until expiry so React StrictMode double-mount
 * (or a page refresh mid-exchange) does not burn the only use.
 */
export declare class LoginCodeService {
    private readonly codes;
    issue(userId: string, ttlMs?: number): string;
    /** Resolve userId without invalidating — safe for concurrent/retry calls. */
    resolve(code: string): string | null;
    /** @deprecated use resolve — kept for any older callers */
    consume(code: string): string | null;
    invalidate(code: string): void;
    private sweep;
}
