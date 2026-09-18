import session = require('express-session');
import { randomBytes } from 'crypto';

type Callback = (err?: unknown, session?: session.SessionData | null) => void;

/**
 * Persist express-session rows via Supabase PostgREST (HTTPS).
 * Works on Vercel where Postgres :5432 is often blocked.
 *
 * Session table requires id + updatedAt (no DB defaults for those).
 * PostgREST PATCH with 0 matches still returns 204 — must check representation.
 */
export class SupabaseSessionStore extends session.Store {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {
    super();
  }

  private headers(extra?: Record<string, string>) {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  get(sid: string, callback: Callback): void {
    const url = `${this.baseUrl}/rest/v1/Session?sid=eq.${encodeURIComponent(sid)}&select=data,expiresAt&limit=1`;
    fetch(url, { headers: this.headers() })
      .then(async (res) => {
        if (!res.ok) throw new Error(`session get ${res.status}`);
        const rows = (await res.json()) as Array<{
          data: string;
          expiresAt: string;
        }>;
        const row = rows[0];
        if (!row) return callback(null, null);
        if (new Date(row.expiresAt).getTime() < Date.now()) {
          return this.destroy(sid, () => callback(null, null));
        }
        callback(null, JSON.parse(row.data) as session.SessionData);
      })
      .catch((err) => callback(err));
  }

  set(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    const maxAge =
      typeof sessionData.cookie?.maxAge === 'number'
        ? sessionData.cookie.maxAge
        : 7 * 24 * 60 * 60 * 1000;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + maxAge).toISOString();
    const userId =
      typeof sessionData.userId === 'string' ? sessionData.userId : null;
    const data = JSON.stringify(sessionData);
    const updatePayload = { data, expiresAt, userId, updatedAt: now };
    const finish = (err?: unknown) => callback?.(err);

    fetch(
      `${this.baseUrl}/rest/v1/Session?sid=eq.${encodeURIComponent(sid)}`,
      {
        method: 'PATCH',
        headers: this.headers({ Prefer: 'return=representation' }),
        body: JSON.stringify(updatePayload),
      },
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`session patch ${res.status}: ${await res.text()}`);
        }
        const rows = (await res.json()) as unknown[];
        if (Array.isArray(rows) && rows.length > 0) return finish();

        const create = await fetch(`${this.baseUrl}/rest/v1/Session`, {
          method: 'POST',
          headers: this.headers({ Prefer: 'return=minimal' }),
          body: JSON.stringify({
            id: `ses_${randomBytes(12).toString('hex')}`,
            sid,
            createdAt: now,
            ...updatePayload,
          }),
        });
        if (!create.ok) {
          throw new Error(
            `session insert ${create.status}: ${await create.text()}`,
          );
        }
        finish();
      })
      .catch((err) => finish(err));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    fetch(
      `${this.baseUrl}/rest/v1/Session?sid=eq.${encodeURIComponent(sid)}`,
      { method: 'DELETE', headers: this.headers() },
    )
      .then(async (res) => {
        if (!res.ok && res.status !== 404) {
          throw new Error(`session destroy ${res.status}`);
        }
        callback?.();
      })
      .catch((err) => callback?.(err));
  }

  touch(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    const maxAge =
      typeof sessionData.cookie?.maxAge === 'number'
        ? sessionData.cookie.maxAge
        : 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + maxAge).toISOString();
    const updatedAt = new Date().toISOString();
    fetch(
      `${this.baseUrl}/rest/v1/Session?sid=eq.${encodeURIComponent(sid)}`,
      {
        method: 'PATCH',
        headers: this.headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ expiresAt, updatedAt }),
      },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`session touch ${res.status}`);
        callback?.();
      })
      .catch((err) => callback?.(err));
  }
}
