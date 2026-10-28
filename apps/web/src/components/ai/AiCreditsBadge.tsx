'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AiAccessDto } from '@timeblock/shared-types';
import { api } from '../../api';

const REFRESH_EVENT = 'tb:ai-credits-refresh';

export function refreshAiCreditsBadge() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
}

/** Compact AI credit meter — left sidebar rail only. */
export function AiCreditsBadge() {
  const [access, setAccess] = useState<AiAccessDto | null>(null);

  const load = useCallback(() => {
    void api
      .get<AiAccessDto>('/api/ai/access')
      .then(setAccess)
      .catch(() => setAccess(null));
  }, []);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    window.addEventListener('focus', onRefresh);
    return () => {
      window.removeEventListener(REFRESH_EVENT, onRefresh);
      window.removeEventListener('focus', onRefresh);
    };
  }, [load]);

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
