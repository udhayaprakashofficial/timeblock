'use client';

/**
 * API base URL.
 *
 * On the Vercel web host, always use same-origin `/api/*` so the session cookie
 * is first-party (Next.js rewrites proxy to Nest). Cross-origin calls to
 * timeblock-server.vercel.app make `timeblock.sid` a third-party cookie —
 * Chrome/Safari often block it, which surfaces as "Not authenticated" while
 * the UI still looks logged in.
 *
 * NEXT_PUBLIC_API_ORIGIN is only honored off Vercel (local split-origin debug).
 */
function resolveApiOrigin(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    // Same-origin /api rewrite = first-party session cookie.
    if (
      host === 'app.cupkey.io' ||
      host === 'cupkey.io' ||
      host.endsWith('.cupkey.io') ||
      host === 'timeblock-web-ashy.vercel.app' ||
      host.endsWith('.vercel.app')
    ) {
      return '';
    }
  }
  return (process.env.NEXT_PUBLIC_API_ORIGIN ?? '').replace(/\/$/, '');
}

function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const origin = resolveApiOrigin();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalized}`;
}

/** Fired on 401 so the shell can clear the fake cached session and route to login. */
export const AUTH_LOST_EVENT = 'timeblock:auth-lost';

function notifyAuthLost() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(AUTH_LOST_EVENT));
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new Error(
      'Cannot reach the server. Check your connection and try again.',
    );
  }
  if (!res.ok) {
    const text = await res.text();
    if (
      res.status === 401 &&
      !path.includes('/users/me') &&
      !path.includes('/auth/')
    ) {
      notifyAuthLost();
    }
    let parsed: {
      error?: string;
      message?: string | string[];
    } | null = null;
    try {
      parsed = JSON.parse(text) as {
        error?: string;
        message?: string | string[];
      };
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      const detail = Array.isArray(parsed.message)
        ? parsed.message.join(', ')
        : parsed.message;
      // Nest puts the useful text in `message` and a generic label in `error`
      throw new Error(detail || parsed.error || text || res.statusText);
    }
    // Next.js proxy often returns plain "Internal Server Error" when the API is down
    if (
      res.status >= 500 ||
      /internal server error/i.test(text) ||
      /^<!DOCTYPE/i.test(text)
    ) {
      throw new Error(
        'Server is temporarily unavailable. Please try again in a moment.',
      );
    }
    throw new Error((text || res.statusText).slice(0, 200));
  }
  // Nest may return 200 with an empty body for `null` — avoid res.json() crash
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Server returned an invalid response. Please try again.');
  }
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export function detectBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    return tz === 'Asia/Calcutta' ? 'Asia/Kolkata' : tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Parse API timestamps as UTC. Naive SQL datetimes (no Z/offset) must not be
 * read as browser-local — that shifts IST meetings by 5.5 hours.
 */
export function parseInstant(value: string): Date {
  const s = value.trim();
  if (!s) return new Date(NaN);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  return new Date(`${normalized}Z`);
}

/** Shift a civil YYYY-MM-DD by delta days (noon UTC avoids DST edges). */
export function shiftDateISO(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Civil YYYY-MM-DD in the given IANA zone (defaults to browser geography). */
export function todayISO(timeZone?: string | null) {
  const tz = timeZone?.trim() || detectBrowserTimeZone();
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

export function formatTimeRange(
  start: string | null,
  end: string | null,
  timeZone?: string | null,
) {
  if (!start || !end) return 'Unscheduled';
  const s = parseInstant(start);
  const e = parseInstant(end);
  const tz = timeZone?.trim() || detectBrowserTimeZone();
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
  return `${fmt(s)} – ${fmt(e)}`;
}
