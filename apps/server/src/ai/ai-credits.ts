/** AI credit limits — 1 successful AI request = 1 credit. */

/** Free: one-time pool (does not refill). */
export const AI_CREDITS_FREE = 5;
/** Active Pro / Annual: monthly pool (UTC calendar month). */
export const AI_CREDITS_PRO = 50;

/**
 * Per-email credit limit overrides (founder / demo seats).
 * Applied on top of plan — hello@ gets a 50 pool without requiring Pro.
 */
export const AI_CREDITS_EMAIL_OVERRIDES: Readonly<Record<string, number>> = {
  'hello@cupkey.io': AI_CREDITS_PRO,
};

/** Bucket key for Free one-time credits (never rotates with the month). */
export const AI_CREDITS_FREE_BUCKET = 'lifetime';

/** When AI_REQUIRE_PRO=false, skip metering (local testing). */
export function aiCreditsUnlimited(): boolean {
  return process.env.AI_REQUIRE_PRO === 'false';
}

export function aiCreditsEmailOverride(
  email?: string | null,
): number | null {
  const key = (email ?? '').trim().toLowerCase();
  if (!key) return null;
  const n = AI_CREDITS_EMAIL_OVERRIDES[key];
  return typeof n === 'number' && n > 0 ? n : null;
}

export function currentAiCreditsMonth(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Bucket for this user: monthly for Pro, lifetime for Free. */
export function aiCreditsBucketForUser(user: {
  plan?: string | null;
  planStatus?: string | null;
}): string {
  return isActiveProUser(user)
    ? currentAiCreditsMonth()
    : AI_CREDITS_FREE_BUCKET;
}

/** Next calendar month label for “refills …” copy (UTC). */
export function nextAiCreditsRefillLabel(
  monthKey = currentAiCreditsMonth(),
): string {
  if (monthKey === AI_CREDITS_FREE_BUCKET) {
    return 'when you upgrade to Pro';
  }
  const [ys, ms] = monthKey.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const next = new Date(Date.UTC(y, m, 1));
  return next.toLocaleString('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function isActiveProUser(user: {
  plan?: string | null;
  planStatus?: string | null;
}): boolean {
  return user.plan === 'pro' && user.planStatus === 'active';
}

export function aiCreditsLimitForUser(user: {
  email?: string | null;
  plan?: string | null;
  planStatus?: string | null;
}): number {
  if (aiCreditsUnlimited()) return 1_000_000;
  const override = aiCreditsEmailOverride(user.email);
  if (override != null) return override;
  return isActiveProUser(user) ? AI_CREDITS_PRO : AI_CREDITS_FREE;
}
