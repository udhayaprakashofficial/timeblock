import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

type PendingLogin = {
  userId: string;
  expiresAt: number;
};

/**
 * Short-lived login codes for Google OAuth handoff (:3001 → Vite :5173).
 * Codes are reusable until expiry so React StrictMode double-mount
 * (or a page refresh mid-exchange) does not burn the only use.
 */
@Injectable()
export class LoginCodeService {
  private readonly codes = new Map<string, PendingLogin>();

  issue(userId: string, ttlMs = 120_000): string {
    this.sweep();
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, { userId, expiresAt: Date.now() + ttlMs });
    return code;
  }

  /** Resolve userId without invalidating — safe for concurrent/retry calls. */
  resolve(code: string): string | null {
    this.sweep();
    const entry = this.codes.get(code);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.codes.delete(code);
      return null;
    }
    return entry.userId;
  }

  /** @deprecated use resolve — kept for any older callers */
  consume(code: string): string | null {
    return this.resolve(code);
  }

  invalidate(code: string): void {
    this.codes.delete(code);
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.codes) {
      if (v.expiresAt < now) this.codes.delete(k);
    }
  }
}
