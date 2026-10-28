import { createHash, randomBytes } from 'crypto';

export const PROD_APP_ORIGIN = 'https://app.cupkey.io';
export const PROD_API_ORIGIN = 'https://timeblock-server.vercel.app';
export const OAUTH_STATE_COOKIE = 'cupkey_google_oauth';

export function appOriginFromRequest(req: Request): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const proto = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0]!.trim();
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return `${proto}://${host.split(',')[0]!.trim()}`;
  }
  if (host.includes('app.cupkey.io') || host.includes('cupkey.io')) {
    return PROD_APP_ORIGIN;
  }
  if (host.trim()) {
    return `${proto}://${host.split(',')[0]!.trim()}`;
  }
  return process.env.VERCEL ? PROD_APP_ORIGIN : 'http://127.0.0.1:5173';
}

export function googleCallbackUrl(appOrigin: string): string {
  if (process.env.VERCEL || process.env.VERCEL_ENV === 'production') {
    return `${PROD_APP_ORIGIN}/api/auth/google/callback`;
  }
  return `${appOrigin}/api/auth/google/callback`;
}

export function nestApiOrigin(): string {
  if (!process.env.VERCEL) {
    return (
      process.env.API_ORIGIN?.replace(/\/$/, '') || 'http://127.0.0.1:3001'
    );
  }
  return (
    process.env.API_ORIGIN?.replace(/\/$/, '') || PROD_API_ORIGIN
  ).replace(/\/$/, '');
}

export function googleClientConfig(): { id: string; secret: string } | null {
  const id = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  if (!id || !secret) return null;
  return { id, secret };
}

export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/schedule';
  try {
    const u = new URL(raw, 'http://local');
    u.searchParams.delete('mode');
    u.searchParams.delete('authError');
    u.searchParams.delete('loginCode');
    const path = u.pathname + u.search;
    if (path === '' || path === '/' || path === '/automate') return '/schedule';
    return path;
  } catch {
    return '/schedule';
  }
}

export function newOAuthState(): string {
  return randomBytes(24).toString('base64url');
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('base64url');
}

export type OAuthCookiePayload = {
  s: string; // state hash
  r: string; // return path
  c: boolean; // calendar intent
};

export function encodeOAuthCookie(payload: OAuthCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeOAuthCookie(raw: string | undefined): OAuthCookiePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as OAuthCookiePayload;
    if (!parsed?.s || typeof parsed.r !== 'string') return null;
    return { s: parsed.s, r: parsed.r, c: Boolean(parsed.c) };
  } catch {
    return null;
  }
}
