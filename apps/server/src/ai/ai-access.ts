/**
 * AI feature access via credits.
 *
 * Free: 5 credits one-time (no refill)
 * Active Pro: 50 credits / calendar month (UTC)
 * No carry-forward for monthly pools.
 *
 * Set AI_REQUIRE_PRO=false to disable metering for local testing.
 */
import type { AiAccessDto } from '@timeblock/shared-types';
import {
  AI_CREDITS_FREE,
  AI_CREDITS_FREE_BUCKET,
  AI_CREDITS_PRO,
  aiCreditsLimitForUser,
  aiCreditsUnlimited,
  isActiveProUser,
  nextAiCreditsRefillLabel,
} from './ai-credits';

export function aiRequirePro(): boolean {
  // Kept for AiAccessDto.requirePro / admin messaging.
  // Metering is credit-based; this flag only means “Pro gets the monthly pool”.
  return process.env.AI_REQUIRE_PRO !== 'false';
}

/** @deprecated Prefer buildAiAccessDto — kept for any legacy imports. */
export function userHasAiAccess(_user: {
  plan?: string | null;
  planStatus?: string | null;
}): boolean {
  return true;
}

export function aiAccessDeniedReason(opts?: {
  isPro?: boolean;
  refillLabel?: string;
}): string {
  if (opts?.isPro) {
    return `You've used all ${AI_CREDITS_PRO} AI credits this month. Refills ${opts.refillLabel || 'next month'} — unused credits do not carry forward.`;
  }
  return `You've used all ${AI_CREDITS_FREE} free AI credits. Upgrade to Pro for ${AI_CREDITS_PRO} credits every month.`;
}

export function buildAiAccessDto(input: {
  user: { plan?: string | null; planStatus?: string | null };
  used: number;
  month: string;
}): AiAccessDto {
  const isPro = isActiveProUser(input.user);
  const unlimited = aiCreditsUnlimited();
  const limit = aiCreditsLimitForUser(input.user);
  const used = unlimited ? 0 : Math.max(0, input.used);
  const remaining = unlimited ? limit : Math.max(0, limit - used);
  const hasAccess = unlimited || remaining > 0;
  const refillLabel =
    input.month === AI_CREDITS_FREE_BUCKET && !isPro
      ? 'when you upgrade to Pro'
      : nextAiCreditsRefillLabel(input.month);

  return {
    enabled: true,
    requirePro: aiRequirePro(),
    hasAccess,
    reason: hasAccess
      ? null
      : aiAccessDeniedReason({ isPro, refillLabel }),
    creditsRemaining: remaining,
    creditsLimit: limit,
    creditsUsed: used,
    creditsMonth: input.month,
    isPro,
    refillLabel,
    freeCreditsMonthly: AI_CREDITS_FREE,
    proCreditsMonthly: AI_CREDITS_PRO,
  };
}
