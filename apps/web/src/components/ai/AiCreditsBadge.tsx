'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AiAccessDto, UserDto } from '@timeblock/shared-types';
import { api } from '../../api';
import { useAppUserOptional } from '../../user-context';

const REFRESH_EVENT = 'tb:ai-credits-refresh';

/** Keep in sync with server AI_CREDITS_EMAIL_OVERRIDES / ai-bff. */
const EMAIL_CREDIT_OVERRIDES: Readonly<Record<string, number>> = {
  'hello@cupkey.io': 50,
};

export function refreshAiCreditsBadge() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
}

function fallbackAccess(user: UserDto | null | undefined): AiAccessDto {
  const email = (user?.email ?? '').trim().toLowerCase();
  const isPro =
    user?.plan === 'pro' &&
    (user.planStatus === 'active' ||
      user.planStatus === 'trialing' ||
      !user.planStatus);
  const override = EMAIL_CREDIT_OVERRIDES[email];
  const limit =
    typeof override === 'number' && override > 0
      ? override
      : isPro
        ? 50
        : 5;
  return {
    enabled: true,
    requirePro: true,
    hasAccess: true,
    reason: null,
    creditsRemaining: limit,
    creditsLimit: limit,
    creditsUsed: 0,
    creditsMonth: isPro
      ? new Date().toISOString().slice(0, 7)
      : 'lifetime',
    isPro: Boolean(isPro),
    refillLabel: isPro ? 'next month' : 'when you upgrade to Pro',
    freeCreditsMonthly: 5,
    proCreditsMonthly: 50,
  };
}

/** Compact AI credit meter — left sidebar rail only. */
export function AiCreditsBadge() {
  const user = useAppUserOptional();
  const [access, setAccess] = useState<AiAccessDto | null>(() =>
    fallbackAccess(user),
  );

  const load = useCallback(() => {
    void api
      .get<AiAccessDto>('/api/ai/access')
      .then((dto) => {
        if (dto && typeof dto.creditsLimit === 'number') {
          setAccess(dto);
        }
      })
      .catch(() => {
        // Nest may 404 in prod while API is stale — keep a visible fallback.
        setAccess((prev) => prev ?? fallbackAccess(user));
      });
  }, [user]);

  useEffect(() => {
    setAccess((prev) => prev ?? fallbackAccess(user));
    load();
    const onRefresh = () => load();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    window.addEventListener('focus', onRefresh);
    return () => {
      window.removeEventListener(REFRESH_EVENT, onRefresh);
      window.removeEventListener('focus', onRefresh);
    };
  }, [load, user]);

  if (!access) return null;

  const remaining = access.creditsRemaining;
  const limit = Math.max(1, access.creditsLimit);
  const empty = remaining <= 0;
  const pct = Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)));
  const title = `${remaining} of ${limit} AI credits · ${
    access.isPro ? 'Pro (monthly)' : 'Free (one-time)'
  }`;

  return (
    <div
      className={`sidebar-ai-card${empty ? ' is-empty' : ''}${
        access.isPro ? ' is-pro' : ''
      }`}
      title={title}
      aria-label={title}
    >
      <span className="sidebar-ai-card-orb" aria-hidden>
        ✦
      </span>
      <strong className="sidebar-ai-card-count">
        {remaining}
        <span>/{limit}</span>
      </strong>
      <em className="sidebar-ai-card-label">AI</em>
      <div
        className="sidebar-ai-card-meter"
        role="progressbar"
        aria-valuenow={remaining}
        aria-valuemin={0}
        aria-valuemax={limit}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
