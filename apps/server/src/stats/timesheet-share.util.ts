import { createHmac, timingSafeEqual } from 'crypto';

export type TimesheetSharePayload = {
  u: string; // userId
  d: string; // YYYY-MM-DD
  e: number; // expiry epoch ms
};

function shareSecret() {
  return (
    process.env.TIMESHEET_SHARE_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    'cupkey-dev-share-secret'
  );
}

function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(value: string) {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(normalized, 'base64');
}

export function createTimesheetShareToken(
  userId: string,
  date: string,
  ttlDays = 30,
): string {
  const payload: TimesheetSharePayload = {
    u: userId,
    d: date.slice(0, 10),
    e: Date.now() + Math.max(1, ttlDays) * 24 * 60 * 60 * 1000,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(
    createHmac('sha256', shareSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifyTimesheetShareToken(
  token: string,
): TimesheetSharePayload | null {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = b64url(
    createHmac('sha256', shareSecret()).update(body).digest(),
  );
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(
      fromB64url(body).toString('utf8'),
    ) as TimesheetSharePayload;
    if (!parsed?.u || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.d || '')) return null;
    if (!Number.isFinite(parsed.e) || parsed.e < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
