import { createHmac, timingSafeEqual } from 'crypto';

const TTL_MS = 60 * 60 * 1000; // 1 hour

function secret(): string {
  return (
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    'dev-encryption-key-change-me'
  );
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString(
    'utf8',
  );
}

/** Fingerprint of current password hash so old links die after a successful reset. */
export function passwordFingerprint(passwordHash: string | null | undefined): string {
  const raw = passwordHash?.trim() || 'none';
  return createHmac('sha256', secret()).update(raw).digest('hex').slice(0, 16);
}

export function issuePasswordResetToken(input: {
  userId: string;
  passwordHash?: string | null;
  ttlMs?: number;
}): string {
  const exp = Date.now() + (input.ttlMs ?? TTL_MS);
  const fp = passwordFingerprint(input.passwordHash);
  const payload = `${input.userId}.${exp}.${fp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest();
  return `${b64url(payload)}.${b64url(sig)}`;
}

/** Decode + check signature/expiry. Caller must still match password fingerprint. */
export function parsePasswordResetToken(
  token: string,
): { userId: string; fingerprint: string } | null {
  const raw = String(token ?? '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  let payload: string;
  let sig: Buffer;
  try {
    payload = fromB64url(payloadB64);
    sig = Buffer.from(
      sigB64.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (sigB64.length % 4)) % 4),
      'base64',
    );
  } catch {
    return null;
  }

  const expected = createHmac('sha256', secret()).update(payload).digest();
  if (expected.length !== sig.length || !timingSafeEqual(expected, sig)) {
    return null;
  }

  const [userId, expStr, fp] = payload.split('.');
  if (!userId || !expStr || !fp) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return { userId, fingerprint: fp };
}

export function verifyPasswordResetToken(
  token: string,
  currentPasswordHash?: string | null,
): { userId: string } | null {
  const parsed = parsePasswordResetToken(token);
  if (!parsed) return null;
  if (parsed.fingerprint !== passwordFingerprint(currentPasswordHash)) {
    return null;
  }
  return { userId: parsed.userId };
}
