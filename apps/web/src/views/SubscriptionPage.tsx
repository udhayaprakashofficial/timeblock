'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../api';
import { buildProCheckoutUrl } from '../lib/billing';
import './subscription.css';

type InvoiceRow = {
  paymentId: string;
  createdAt: string;
  amountLabel: string;
  currency: string;
  status: string;
};

type BillingSummary = {
  plan: 'free' | 'pro';
  planLabel: string;
  status: string;
  statusLabel: string;
  since: string | null;
  paidAt?: string | null;
  activatedAt?: string | null;
  periodEnd?: string | null;
  daysRemaining?: number | null;
  isPending?: boolean;
  isActive?: boolean;
  invoices: InvoiceRow[];
  invoicesAvailable: boolean;
  apiKeyConfigured?: boolean;
};

function formatSince(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function SubscriptionPage({ user }: { user: UserDto }) {
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const summary = useQuery({
    queryKey: ['billing-summary'],
    queryFn: () => api.get<BillingSummary>('/api/billing/summary'),
    staleTime: 5_000,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = (params.get('status') || '').toLowerCase();
    const paymentId =
      params.get('payment_id') || params.get('paymentId') || '';
    const subscriptionId =
      params.get('subscription_id') || params.get('subscriptionId') || '';

    // Subscriptions return status=active + subscription_id (not pay_ + succeeded)
    const okStatus =
      status === 'succeeded' || status === 'success' || status === 'active';
    if (!okStatus) return;

    const idIsPay = /^pay_[\w-]+$/i.test(paymentId);
    const idIsSub =
      /^sub_[\w-]+$/i.test(subscriptionId) ||
      /^sub_[\w-]+$/i.test(paymentId);
    if (!idIsPay && !idIsSub) {
      setErr(
        'Checkout returned without a payment or subscription id. If you were charged, wait a minute and refresh, or contact support with your Dodo receipt.',
      );
      return;
    }

    let cancelled = false;
    setConfirming(true);
    setBanner('Confirming your payment…');

    void (async () => {
      try {
        const result = await api.post<{
          ok: boolean;
          plan: string;
          user?: UserDto;
        }>('/api/billing/confirm', {
          paymentId: idIsPay ? paymentId : undefined,
          subscriptionId: idIsSub
            ? subscriptionId || paymentId
            : undefined,
          status: status || 'succeeded',
        });
        if (cancelled) return;
        if (result.user) qc.setQueryData(['me'], result.user);
        await qc.invalidateQueries({ queryKey: ['billing-summary'] });
        await qc.invalidateQueries({ queryKey: ['me'] });
        setBanner('Congratulations — Pro is locked in for your account.');
        const url = new URL(window.location.href);
        [
          'status',
          'payment_id',
          'paymentId',
          'subscription_id',
          'subscriptionId',
          'email',
        ].forEach((k) => url.searchParams.delete(k));
        window.history.replaceState({}, '', url.pathname + url.search);
      } catch (e) {
        if (!cancelled) {
          setErr(
            e instanceof Error
              ? e.message
              : 'Could not confirm payment. Refresh or contact support.',
          );
          setBanner(null);
        }
      } finally {
        if (!cancelled) setConfirming(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [qc]);

  const plan = summary.data?.plan ?? user.plan ?? 'free';
  const isPro = plan === 'pro';
  const isPending =
    summary.data?.isPending ??
    (isPro && user.planStatus !== 'active');
  const isActive =
    summary.data?.isActive ??
    (isPro && user.planStatus === 'active');
  const statusLabel =
    summary.data?.statusLabel ??
    (isActive
      ? 'Active'
      : isPro
        ? 'Paid — waiting for AI go-live'
        : 'No paid subscription');
  const planLabel = summary.data?.planLabel ?? (isPro ? 'Pro' : 'Free');
  const invoices = summary.data?.invoices ?? [];

  const upgradeHref = useMemo(
    () =>
      buildProCheckoutUrl({
        id: user.id,
        email: user.email,
        name: user.name,
      }),
    [user.id, user.email, user.name],
  );

  const onDownload = async (paymentId: string) => {
    setErr(null);
    setDownloading(paymentId);
    try {
      const res = await fetch(
        `/api/billing/invoices/${encodeURIComponent(paymentId)}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const text = await res.text();
        let msg = 'Could not download invoice';
        try {
          const j = JSON.parse(text) as { error?: string; message?: string };
          msg = j.message || j.error || msg;
        } catch {
          /* plain */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cupkey-invoice-${paymentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="sub-page">
      <header className="sub-head">
        <p className="sub-kicker">Subscription</p>
        <h1>Your plan</h1>
        <p className="sub-lede">
          Current status for this account — plan, activation, and invoices.
        </p>
      </header>

      {banner ? (
        <p className="sub-banner" role="status">
          {banner}
        </p>
      ) : null}

      {isPending ? (
        <section className="sub-card sub-congrats" aria-label="Congratulations">
          <p className="sub-label">Congratulations</p>
          <p className="sub-plan-name">You’re locked into Pro</p>
          <p className="sub-note">
            Thanks for supporting Cupkey. AI features aren’t live yet — Pro
            activates the day those features ship. Your subscription countdown
            starts on that activation day, not today.
          </p>
        </section>
      ) : null}

      <section className="sub-card" aria-label="Current plan">
        <div className="sub-card-row">
          <div>
            <p className="sub-label">Current plan</p>
            <p className="sub-plan-name">{planLabel}</p>
          </div>
          <span
            className={`sub-badge${
              isActive ? ' is-pro' : isPro ? ' is-pending' : ' is-free'
            }`}
          >
            {isActive ? 'Active' : isPro ? 'Paid' : 'Free'}
          </span>
        </div>

        <dl className="sub-meta">
          <div>
            <dt>Status</dt>
            <dd>{confirming ? 'Confirming…' : statusLabel}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>{formatSince(summary.data?.paidAt ?? summary.data?.since)}</dd>
          </div>
          <div>
            <dt>{isActive ? 'Cycle ends' : 'Account'}</dt>
            <dd>
              {isActive
                ? `${formatSince(summary.data?.periodEnd ?? null)}${
                    summary.data?.daysRemaining != null
                      ? ` · ${summary.data.daysRemaining}d left`
                      : ''
                  }`
                : user.email}
            </dd>
          </div>
        </dl>

        {!isPro ? (
          <div className="sub-actions">
            <a
              href={upgradeHref}
              className="sub-btn is-primary"
              rel="noopener noreferrer"
            >
              Upgrade to Pro — $10/mo
            </a>
            {summary.data?.apiKeyConfigured ? (
              <button
                type="button"
                className="sub-btn is-outline"
                disabled={confirming}
                onClick={() => {
                  setConfirming(true);
                  setErr(null);
                  void api
                    .post<{
                      synced?: boolean;
                      plan?: string;
                      user?: UserDto;
                    }>('/api/billing/sync')
                    .then(async (result) => {
                      if (result.user) qc.setQueryData(['me'], result.user);
                      await qc.invalidateQueries({
                        queryKey: ['billing-summary'],
                      });
                      await qc.invalidateQueries({ queryKey: ['me'] });
                      if (result.synced || result.plan === 'pro') {
                        setBanner(
                          'Payment found — Pro is locked in for your account.',
                        );
                      } else {
                        setErr(
                          'No successful Dodo payment found for this email yet.',
                        );
                      }
                    })
                    .catch((e) => {
                      setErr(
                        e instanceof Error
                          ? e.message
                          : 'Could not sync payment from Dodo',
                      );
                    })
                    .finally(() => setConfirming(false));
                }}
              >
                {confirming ? 'Checking Dodo…' : 'I paid — refresh status'}
              </button>
            ) : null}
          </div>
        ) : isActive ? (
          <p className="sub-note">
            Pro is live. Subscription period started{' '}
            {formatSince(summary.data?.activatedAt)}. Next cycle ends{' '}
            {formatSince(summary.data?.periodEnd)}.
          </p>
        ) : (
          <p className="sub-note">
            You’ll get an email the moment we activate Pro for everyone who
            paid.
          </p>
        )}
      </section>

      {isPro ? (
        <section className="sub-card" aria-label="Invoices">
          <div className="sub-card-row">
            <div>
              <p className="sub-label">Invoices</p>
              <p className="sub-section-title">Download receipts</p>
            </div>
            <button
              type="button"
              className="sub-btn is-ghost"
              disabled={summary.isFetching}
              onClick={() =>
                void qc.invalidateQueries({ queryKey: ['billing-summary'] })
              }
            >
              Refresh
            </button>
          </div>

          {err ? (
            <p className="sub-error" role="alert">
              {err}
            </p>
          ) : null}

          {summary.isLoading ? (
            <p className="sub-empty">Loading invoices…</p>
          ) : summary.data?.invoicesAvailable === false ? (
            <p className="sub-empty">
              Invoices come from Dodo Payments. Add{' '}
              <code>DODO_PAYMENTS_API_KEY</code> on the server (Dodo → Developer
              → API), restart, then Refresh.
            </p>
          ) : invoices.length === 0 ? (
            <p className="sub-empty">
              No Dodo invoices found yet for this account. If you just paid,
              wait a minute and hit Refresh — or confirm checkout returned a{' '}
              <code>payment_id</code>.
            </p>
          ) : (
            <ul className="sub-invoice-list">
              {invoices.map((inv) => (
                <li key={inv.paymentId}>
                  <div>
                    <strong>{inv.amountLabel}</strong>
                    <span>
                      {formatSince(inv.createdAt)}
                      {inv.status ? ` · ${inv.status}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sub-btn is-outline"
                    disabled={downloading === inv.paymentId}
                    onClick={() => void onDownload(inv.paymentId)}
                  >
                    {downloading === inv.paymentId
                      ? 'Downloading…'
                      : 'Download invoice'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : err ? (
        <p className="sub-error" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
