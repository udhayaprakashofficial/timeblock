'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AiAccessDto } from '@timeblock/shared-types';
import { api } from '../../api';

type Props = {
  access?: AiAccessDto | null;
  reason?: string | null;
  onClose?: () => void;
};

export function AiUpgradePanel({ access, reason, onClose }: Props) {
  const [busy, setBusy] = useState<'pro' | 'annual' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isProEmpty = Boolean(access?.isPro && !access.hasAccess);
  const freeLimit = access?.freeCreditsMonthly ?? 5;
  const proLimit = access?.proCreditsMonthly ?? 50;
  const refill = access?.refillLabel ?? 'next month';
  const proPoints = [
    `${proLimit} AI credits every month`,
    'Spotlight — tasks to LinkedIn and X posts',
    'Homer — appraisal prep & interview pitches',
    'Searchable history of finished work',
  ];

  const startCheckout = async (plan: 'pro' | 'annual') => {
    setBusy(plan);
    setErr(null);
    try {
      const result = await api.post<{
        checkoutUrl?: string | null;
        alreadyPro?: boolean;
        soldOut?: boolean;
        error?: string;
      }>('/api/billing/checkout', { plan });
      if (result.alreadyPro) {
        window.location.href = '/settings?panel=subscription';
        return;
      }
      if (result.soldOut) {
        setErr(result.error || 'Founding offer sold out');
        return;
      }
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      window.location.href = `/pricing?buy=${plan}`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start checkout');
    } finally {
      setBusy(null);
    }
  };

  if (isProEmpty) {
    return (
      <section className="ai-upgrade" aria-label="AI credits used up">
        <p className="ai-upgrade-lede">
          {reason?.trim() ||
            `You've used all ${proLimit} Pro AI credits this month. Credits refill on ${refill} and do not carry forward.`}
        </p>
        <div className="ai-upgrade-card is-featured">
          <p className="ai-upgrade-pill">Pro plan</p>
          <h3>
            {access?.creditsUsed ?? proLimit}/{proLimit} used
          </h3>
          <p className="ai-upgrade-was">Refills {refill}</p>
          <ul>
            <li>1 AI request = 1 credit</li>
            <li>Monthly pool resets automatically</li>
            <li>Unused credits do not roll over</li>
          </ul>
          <Link
            href="/settings?panel=subscription"
            className="btn btn-primary"
            onClick={() => onClose?.()}
          >
            View subscription
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="ai-upgrade" aria-label="Upgrade for more AI credits">
      <p className="ai-upgrade-lede">
        {reason?.trim() ||
          `Free includes ${freeLimit} AI credits (one-time). Pro adds ${proLimit} credits every month. Unused credits do not carry forward.`}
      </p>

      <div className="ai-upgrade-grid">
        <article className="ai-upgrade-card is-featured">
          <p className="ai-upgrade-pill">Recommended</p>
          <h3>Pro</h3>
          <p className="ai-upgrade-price">
            $11<span>/month</span>
          </p>
          <p className="ai-upgrade-was">{proLimit} AI credits / month</p>
          <ul>
            {proPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => void startCheckout('pro')}
          >
            {busy === 'pro' ? 'Starting…' : 'Upgrade to Pro'}
          </button>
        </article>

        <article className="ai-upgrade-card">
          <p className="ai-upgrade-pill">Limited</p>
          <h3>Annual welcome</h3>
          <p className="ai-upgrade-price">
            $29<span>/year</span>
          </p>
          <p className="ai-upgrade-was">was $99/year · {proLimit} credits/mo</p>
          <ul>
            <li>Everything in Pro</li>
            <li>Founding member rate</li>
            <li>Best value for the year</li>
          </ul>
          <button
            type="button"
            className="btn btn-outline"
            disabled={busy !== null}
            onClick={() => void startCheckout('annual')}
          >
            {busy === 'annual' ? 'Starting…' : 'Get Annual Plan'}
          </button>
        </article>
      </div>

      {err ? <p className="ai-hub-err">{err}</p> : null}

      <p className="ai-upgrade-foot">
        <Link href="/pricing" onClick={() => onClose?.()}>
          Compare all plans
        </Link>
        {' · '}
        <Link href="/settings?panel=subscription" onClick={() => onClose?.()}>
          Manage subscription
        </Link>
      </p>
    </section>
  );
}
