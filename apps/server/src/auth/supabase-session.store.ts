import session = require('express-session');

type Callback = (err?: unknown, session?: session.SessionData | null) => void;

/**
 * Persist express-session rows via Supabase PostgREST (HTTPS).
 * Works on Vercel where Postgres :5432 is often blocked.
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
        const rows = (await res.json()) as Array<{ data: string; expiresAt: string }>;
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
    const expiresAt = new Date(Date.now() + maxAge).toISOString();
    const userId =
      typeof sessionData.userId === 'string' ? sessionData.userId : null;
    const data = JSON.stringify(sessionData);
    const body = { sid, data, expiresAt, userId };

    // Upsert on unique sid
    fetch(`${this.baseUrl}/rest/v1/Session?on_conflict=sid`, {
      method: 'POST',
      headers: this.headers({
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`session set ${res.status}: ${text}`);
        }
        callback?.();
      })
      .catch((err) => callback?.(err));
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
    fetch(
      `${this.baseUrl}/rest/v1/Session?sid=eq.${encodeURIComponent(sid)}`,
      {
        method: 'PATCH',
        headers: this.headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ expiresAt }),
      },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`session touch ${res.status}`);
        callback?.();
      })
      .catch((err) => callback?.(err));
  }
}
