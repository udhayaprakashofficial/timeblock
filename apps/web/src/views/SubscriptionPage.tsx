'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../api';
import {
  buildAnnualWelcomeCheckoutUrl,
  buildProCheckoutUrl,
  catalogFromApi,
} from '../lib/billing';
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
  planTier?: 'free' | 'pro_monthly' | 'annual_welcome';
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

const PRO_HIGHLIGHTS = [
  'Everything in Free',
  'AI work summaries',
  'Searchable work history',
  'Priority support',
];

const ANNUAL_HIGHLIGHTS = [
  'Everything in Pro for a year',
  'Lock in $29/year',
  'AI features the day they ship',
  'Founding member list',
];

type BillingConfig = {
  proProductId: string;
  annualWelcomeProductId: string;
  checkoutBase?: string;
  annualWelcomeLimit?: number;
  annualWelcomeTaken?: number;
  annualWelcomeRemaining?: number;
  annualWelcomeSoldOut?: boolean;
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
  const [syncing, setSyncing] = useState(false);

  const summary = useQuery({
    queryKey: ['billing-summary'],
    queryFn: () => api.get<BillingSummary>('/api/billing/summary'),
    staleTime: 5_000,
  });

  const billingCatalogQuery = useQuery({
    queryKey: ['billing-config'],
    queryFn: () => api.get<BillingConfig>('/api/billing/config'),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const billingCatalog = useMemo(
    () => catalogFromApi(billingCatalogQuery.data),
    [billingCatalogQuery.data],
  );
  const annualLimit = billingCatalogQuery.data?.annualWelcomeLimit ?? 10;
  const annualRemaining =
    billingCatalogQuery.data?.annualWelcomeRemaining ??
    Math.max(
      0,
      annualLimit - (billingCatalogQuery.data?.annualWelcomeTaken ?? 0),
    );
  const annualSoldOut =
    billingCatalogQuery.data?.annualWelcomeSoldOut ?? annualRemaining <= 0;
  const [annualStarting, setAnnualStarting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = (params.get('status') || '').toLowerCase();
    const paymentId =
      params.get('payment_id') || params.get('paymentId') || '';
    const subscriptionId =
      params.get('subscription_id') || params.get('subscriptionId') || '';

    const okStatus =
      status === 'succeeded' || status === 'success' || status === 'active';
    if (!okStatus) return;

    const idIsPay = /^pay_[\w-]+$/i.test(paymentId);
    const idIsSub =
      /^sub_[\w-]+$/i.test(subscriptionId) ||
      /^sub_[\w-]+$/i.test(paymentId);
    if (!idIsPay && !idIsSub) {
      setErr(
        'Checkout returned without a payment or subscription id. If you were charged, wait a minute and refresh, or contact support with your receipt.',
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
    summary.data?.isPending ?? (isPro && user.planStatus !== 'active');
  const isActive =
    summary.data?.isActive ?? (isPro && user.planStatus === 'active');
  const statusLabel =
    summary.data?.statusLabel ??
    (isActive
      ? 'Active'
      : isPro
        ? 'Paid — waiting for AI go-live'
        : 'No active subscription');
  const planLabel = summary.data?.planLabel ?? (isPro ? 'Pro' : 'Free');
  const planTier = summary.data?.planTier;
  const isAnnualWelcome = planTier === 'annual_welcome';
  const invoices = summary.data?.invoices ?? [];

  const priceDisplay = !isPro
    ? { amount: '$0', note: 'Forever' }
    : isAnnualWelcome
      ? { amount: '$29', note: '/ year' }
      : { amount: '$11', note: '/ month' };

  const badgeLabel = isActive ? 'Active' : isPro ? 'Paid' : 'Free';
  const badgeTone = isActive ? 'is-pro' : isPro ? 'is-pending' : 'is-free';

  const checkoutCustomer = useMemo(
    () => ({ id: user.id, email: user.email, name: user.name }),
    [user.id, user.email, user.name],
  );

  const proCheckoutHref = useMemo(
    () => buildProCheckoutUrl(billingCatalog, checkoutCustomer),
    [billingCatalog, checkoutCustomer],
  );

  const startAnnualCheckout = async () => {
    setErr(null);
    setAnnualStarting(true);
    try {
      if (annualSoldOut) {
        setErr('Founding offer sold out');
        return;
      }

      // New API advertises founding seats on /billing/config. Until that
      // ships, use the static Annual Welcome Dodo link (never Pro monthly).
      const foundingApiReady =
        typeof billingCatalogQuery.data?.annualWelcomeLimit === 'number';

      if (foundingApiReady) {
        const result = await api.post<{
          checkoutUrl?: string | null;
          soldOut?: boolean;
          error?: string;
        }>('/api/billing/checkout', { plan: 'annual' });
        if (result.soldOut) {
          setErr(result.error || 'Founding offer sold out');
          await qc.invalidateQueries({ queryKey: ['billing-config'] });
          return;
        }
        if (result.checkoutUrl) {
          window.location.href = result.checkoutUrl;
          return;
        }
      }

      const fallback = buildAnnualWelcomeCheckoutUrl(
        billingCatalog,
        checkoutCustomer,
      );
      if (!fallback) {
        setErr('Could not start Annual Welcome checkout');
        return;
      }
      window.location.href = fallback;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const fallback = buildAnnualWelcomeCheckoutUrl(
        billingCatalog,
        checkoutCustomer,
      );
      if (fallback) {
        window.location.href = fallback;
        return;
      }
      setErr(msg || 'Could not start Annual Welcome checkout');
    } finally {
      setAnnualStarting(false);
    }
  };

  const refreshPaymentStatus = () => {
    setSyncing(true);
    setErr(null);
    void api
      .post<{
        synced?: boolean;
        plan?: string;
        user?: UserDto;
      }>('/api/billing/sync')
      .then(async (result) => {
        if (result.user) qc.setQueryData(['me'], result.user);
        await qc.invalidateQueries({ queryKey: ['billing-summary'] });
        await qc.invalidateQueries({ queryKey: ['me'] });
        if (result.synced || result.plan === 'pro') {
          setBanner('Payment found — Pro is locked in for your account.');
        } else {
          setErr('No successful payment found for this email yet.');
        }
      })
      .catch((e) => {
        setErr(
          e instanceof Error ? e.message : 'Could not refresh payment status',
        );
      })
      .finally(() => setSyncing(false));
  };

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
      {banner ? (
        <p className="sub-banner" role="status">
          {banner}
        </p>
      ) : null}

      <section className="sub-current" aria-label="Current plan">
        <div className="sub-current-top">
          <div>
            <p className="sub-label">Current plan</p>
            <h2 className="sub-plan-name">{planLabel}</h2>
          </div>
          <span className={`sub-badge ${badgeTone}`}>{badgeLabel}</span>
        </div>

        <div className="sub-current-price">
          <strong>{priceDisplay.amount}</strong>
          <span>{priceDisplay.note}</span>
        </div>

        <dl className="sub-meta">
          <div>
            <dt>Billing status</dt>
            <dd>{confirming ? 'Confirming…' : statusLabel}</dd>
          </div>
          {isPro ? (
            <div>
              <dt>{isActive ? 'Cycle ends' : 'Paid'}</dt>
              <dd>
                {isActive
                  ? `${formatSince(summary.data?.periodEnd ?? null)}${
                      summary.data?.daysRemaining != null
                        ? ` · ${summary.data.daysRemaining}d left`
                        : ''
                    }`
                  : formatSince(summary.data?.paidAt ?? summary.data?.since)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Account</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>

        {isPending ? (
          <p className="sub-note">
            Billing starts when AI features go live. You’ll get an email when{' '}
            {planLabel} activates.
          </p>
        ) : null}
      </section>

      {!isPro ? (
        <section className="sub-upgrade" aria-label="Upgrade plans">
          <div className="sub-upgrade-head">
            <h3>Upgrade your plan</h3>
            <p>Choose a plan that fits your workflow.</p>
          </div>

          <div className="sub-plan-grid">
            <article className="sub-plan-card">
              <div className="sub-plan-card-head">
                <h4>Pro</h4>
                <span className="sub-plan-pill">Recommended</span>
              </div>
              <p className="sub-plan-price">
                $11<span> / month</span>
              </p>
              <p className="sub-plan-blurb">
                Lock the price now. Billing starts when AI ships.
              </p>
              <ul>
                {PRO_HIGHLIGHTS.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a
                href={proCheckoutHref}
                className="sub-btn is-primary"
                rel="noopener noreferrer"
              >
                Upgrade to Pro
              </a>
            </article>

            <article className="sub-plan-card is-accent">
              <div className="sub-plan-card-head">
                <h4>Annual welcome</h4>
                <span className="sub-plan-pill is-solid">Limited</span>
              </div>
              <p className="sub-plan-price-was" aria-label="Regular price $99 per year">
                $99<span> / year</span>
              </p>
              <p className="sub-plan-price">
                $29<span> / year</span>
              </p>
              <p className="sub-plan-blurb">
                Founding rate for the first {annualLimit} members.
              </p>
              <p className="sub-plan-seats" role="status">
                {annualSoldOut
                  ? 'Founding offer sold out'
                  : `${annualRemaining} of ${annualLimit} spots remaining`}
              </p>
              <ul>
                {ANNUAL_HIGHLIGHTS.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {annualSoldOut ? (
                <button
                  type="button"
                  className="sub-btn is-primary"
                  disabled
                  aria-disabled="true"
                >
                  Founding offer sold out
                </button>
              ) : (
                <button
                  type="button"
                  className="sub-btn is-primary"
                  disabled={annualStarting}
                  onClick={() => void startAnnualCheckout()}
                >
                  {annualStarting ? 'Starting checkout…' : 'Get Annual Plan'}
                </button>
              )}
            </article>
          </div>

          {summary.data?.apiKeyConfigured ? (
            <button
              type="button"
              className="sub-sync-link"
              disabled={syncing || confirming}
              onClick={refreshPaymentStatus}
            >
              {syncing ? 'Checking payment…' : 'Already paid? Refresh status'}
            </button>
          ) : null}
        </section>
      ) : (
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

          {summary.isLoading ? (
            <p className="sub-empty">Loading invoices…</p>
          ) : summary.data?.invoicesAvailable === false ? (
            <p className="sub-empty">
              Invoices will appear here once billing is configured.
            </p>
          ) : invoices.length === 0 ? (
            <p className="sub-empty">No invoices yet for this account.</p>
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
                      : 'Download'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {err ? (
        <p className="sub-error" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
