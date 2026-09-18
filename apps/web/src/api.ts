'use client';

/**
 * Resolve API base URL.
 * Prefer NEXT_PUBLIC_API_ORIGIN; on the production web host, fall back to the
 * Nest server so requests never hit the Next.js domain's /api (which 401s).
 */
function resolveApiOrigin(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_API_ORIGIN ?? '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'timeblock-web-ashy.vercel.app' || host.endsWith('-web-ashy.vercel.app')) {
      return 'https://timeblock-server.vercel.app';
    }
  }
  return '';
}

function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const origin = resolveApiOrigin();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalized}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as {
        error?: string;
        message?: string | string[];
      };
      const detail = Array.isArray(json.message)
        ? json.message.join(', ')
        : json.message;
      // Nest puts the useful text in `message` and a generic label in `error`
      throw new Error(detail || json.error || text || res.statusText);
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e;
      throw new Error(text || res.statusText);
    }
  }
  // Nest may return 200 with an empty body for `null` — avoid res.json() crash
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
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
