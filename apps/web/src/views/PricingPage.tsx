'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { CupkeyLogo } from '../components/CupkeyLogo';
import { api } from '../api';
import {
  buildProCheckoutUrl,
} from '../lib/billing';
import './pricing.css';

const FREE_FEATURES = [
  'Google and Outlook calendars',
  'Brain-dump with time costs',
  'The 80% cap and its warnings',
  'Start / stop timing',
  'Estimate against actual',
  'Day close and the Friday sheet',
  'Streaks and badges',
];

const PRO_FEATURES = [
  'Everything in Free',
  'Searchable history of finished work',
  'AI work summary for appraisals',
  'A record of a whole role, for interviews',
  'Finished tasks turned into posts',
  'Priority support',
];

const ANNUAL_FEATURES = [
  'Everything in Pro, for a year',
  'Every AI feature the day it ships',
  'Your $12 stays $12 while you stay subscribed',
  'Your name in the founding list',
  'A say in what gets built next',
];

const COMPARE_ROWS: Array<{
  label: string;
  free: boolean;
  pro: boolean;
  annual: boolean;
  emphasize?: boolean;
}> = [
  {
    label: 'Google and Outlook calendar sync',
    free: true,
    pro: true,
    annual: true,
  },
  {
    label: 'Brain-dump with a time cost per task',
    free: true,
    pro: true,
    annual: true,
  },
  {
    label: 'The 80% cap and overcommit warnings',
    free: true,
    pro: true,
    annual: true,
  },
  {
    label: 'Start / stop timing, estimate against actual',
    free: true,
    pro: true,
    annual: true,
  },
  {
    label: 'Day close and the printable Friday sheet',
    free: true,
    pro: true,
    annual: true,
  },
  {
    label: 'Streaks, badges and shareable weeks',
    free: true,
    pro: true,
    annual: true,
  },
  {
    label: 'Searchable history of everything you finished',
    free: false,
    pro: true,
    annual: true,
  },
  {
    label: 'AI work summary for appraisals',
    free: false,
    pro: true,
    annual: true,
  },
  {
    label: 'A record of a whole role, written for interviews',
    free: false,
    pro: true,
    annual: true,
  },
  {
    label: 'Finished tasks turned into post-ready recaps',
    free: false,
    pro: true,
    annual: true,
  },
  {
    label: 'Price held for a year at the welcome rate',
    free: false,
    pro: false,
    annual: true,
    emphasize: true,
  },
];

const FAQS = [
  {
    q: 'What am I paying for today?',
    a: 'A price, not a product you already have. The planner is free: hours, calendars, the 80% cap, the timer, the day close, the Friday sheet. Pro is the AI layer on top of it, and that layer is not live yet.',
  },
  {
    q: 'When does Pro actually start?',
    a: 'We expect the AI features to go live within 30 days. If you take Pro or the Annual welcome now, you lock in today’s price and billing begins on the day those features ship. Not before.',
  },
  {
    q: 'Then why buy before it’s live?',
    a: 'One reason only: the price. $10 a month, or $12 for a whole year if you are one of the next ten. If locking that in doesn’t feel worth it, stay on Free and upgrade the week it ships. We would genuinely rather you did that.',
  },
  {
    q: 'What happens when the 10 seats go?',
    a: 'The annual price moves to $16 and stays there. Anyone already on $12 keeps $12 for as long as they stay subscribed. When the seats run out this page will say so, rather than quietly resetting the counter.',
  },
  {
    q: 'Which calendars do you read?',
    a: 'Google Calendar and Outlook, read-only. Cupkey pulls in the meetings you can’t move so it can plan around them, and writes nothing back until you switch on two-way sync yourself.',
  },
  {
    q: 'Can I move the 80% cap?',
    a: 'Yes, in settings, and day by day if you want. Eighty is the default because the last fifth of a day is what absorbs the surprises. Move it wherever you like and Cupkey will still tell you the moment you cross it.',
  },
  {
    q: 'Can I cancel?',
    a: 'Any time, from settings, without emailing anyone. Monthly runs to the end of the current month. Annual is refundable within 14 days of the AI features going live, since that is the first moment you can fairly judge them.',
  },
  {
    q: 'Is Free going to get worse later?',
    a: 'No. The planning half of Cupkey is the point, and it stays free. New things that cost us money to run, like the AI reports, go into Pro. Nothing that is free today moves behind the paywall.',
  },
];

const WELCOME_TAKEN = 3;
const WELCOME_TOTAL = 10;

function ArrowMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="26"
      height="18"
      viewBox="0 0 26 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M2 9h9l6-6M11 9l6 6" />
    </svg>
  );
}

function Dot({ tone }: { tone: 'ink' | 'accent' | 'empty' }) {
  if (tone === 'empty') {
    return <span className="pricing-dash">—</span>;
  }
  return (
    <span
      className={`pricing-dot${tone === 'accent' ? ' is-accent' : ''}`}
      aria-hidden
    />
  );
}

export function PricingPage({
  signedIn = false,
  user = null,
  embedded = false,
}: {
  signedIn?: boolean;
  user?: UserDto | null;
  /** Inside dashboard shell — no marketing chrome */
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const joinHref = signedIn ? '/schedule' : '/login';
  const joinLabel = signedIn ? 'Open dashboard' : 'Join Cupkey';
  const isPro = user?.plan === 'pro';

  const proCheckoutHref = useMemo(() => {
    // Guests can pay too — Dodo collects email; webhook matches by email.
    return buildProCheckoutUrl(
      signedIn && user
        ? { id: user.id, email: user.email, name: user.name }
        : null,
    );
  }, [signedIn, user]);

  const [checkoutBanner, setCheckoutBanner] = useState<
    'success' | 'failed' | null
  >(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = (params.get('status') || '').toLowerCase();
    const paymentId =
      params.get('payment_id') || params.get('paymentId') || '';
    const buy = params.get('buy');

    if (status === 'failed' || status === 'cancelled') {
      setCheckoutBanner('failed');
    }

    if (buy === 'pro' && signedIn && user && !isPro) {
      window.location.assign(
        buildProCheckoutUrl({
          id: user.id,
          email: user.email,
          name: user.name,
        }),
      );
      return;
    }

    // Real Dodo return: confirm only with payment_id (never bare "success")
    if (
      signedIn &&
      user &&
      !isPro &&
      (status === 'succeeded' || status === 'success') &&
      paymentId
    ) {
      let cancelled = false;
      setCheckoutBanner('success');
      void (async () => {
        try {
          const result = await api.post<{ user?: UserDto }>(
            '/api/billing/confirm',
            { paymentId, status: 'succeeded' },
          );
          if (cancelled) return;
          if (result.user) qc.setQueryData(['me'], result.user);
          await qc.invalidateQueries({ queryKey: ['me'] });
          await qc.invalidateQueries({ queryKey: ['billing-summary'] });
          const url = new URL(window.location.href);
          [
            'status',
            'payment_id',
            'paymentId',
            'subscription_id',
            'email',
          ].forEach((k) => url.searchParams.delete(k));
          window.history.replaceState({}, '', url.pathname + url.search);
        } catch {
          if (!cancelled) setCheckoutBanner('failed');
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (status === 'succeeded' || status === 'success') {
      setCheckoutBanner('success');
    }
  }, [signedIn, user, isPro, qc]);

  return (
    <div
      className={`pricing-page${embedded ? ' is-embedded' : ''}`}
      data-embedded={embedded ? 'true' : undefined}
    >
      {!embedded ? (
        <header className="pricing-nav">
          <Link href={signedIn ? '/schedule' : '/'} className="pricing-brand">
            <CupkeyLogo size={28} title="cupkey.io" />
          </Link>
          <nav className="pricing-nav-links" aria-label="Pricing">
            <a href="#top" className="is-active">
              Pricing
            </a>
            {!signedIn ? (
              <>
                <Link href="/login">Login</Link>
                <Link href="/login">Sign up</Link>
              </>
            ) : null}
            <Link href={joinHref} className="pricing-nav-cta">
              {joinLabel}
            </Link>
          </nav>
        </header>
      ) : null}

      {checkoutBanner ? (
        <div
          className={`pricing-checkout-banner${
            checkoutBanner === 'failed' ? ' is-failed' : ''
          }`}
          role="status"
        >
          {checkoutBanner === 'success'
            ? 'Payment received. Pro is locked in — AI features unlock when they ship (~30 days). Billing starts then.'
            : 'Checkout didn’t complete. You can try again anytime — nothing was charged.'}
        </div>
      ) : null}

      <section id="top" className="pricing-band pricing-hero">
        <div className="pricing-rail" aria-hidden />
        <div className="pricing-band-inner">
          <div className="pricing-kicker">
            <ArrowMark />
            <span>{embedded ? 'Subscription' : 'Pricing'}</span>
          </div>
          <h1>
            {embedded
              ? 'Your plan options'
              : 'The planner is free. You pay for the receipts.'}
          </h1>
          <p className="pricing-lede">
            {embedded
              ? 'Free covers planning forever. Pro locks AI receipts and work history — billing starts when those features ship.'
              : 'Everything you need to plan a finishable day costs nothing, forever. Pro is the layer that turns the work you finished into something you can hand to a manager, or an interviewer.'}
          </p>

          <div className="pricing-plans">
            <article className="pricing-card">
              <h2>Free</h2>
              <p className="pricing-price">$0</p>
              <p className="pricing-price-note">
                Forever. Not a trial, not a teaser.
              </p>
              <hr />
              <ul>
                {FREE_FEATURES.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {embedded && !isPro ? (
                <span className="pricing-btn is-outline is-current">
                  Current plan
                </span>
              ) : (
                <Link href={joinHref} className="pricing-btn is-outline">
                  {joinLabel}
                </Link>
              )}
            </article>

            <article className="pricing-card">
              <div className="pricing-card-head">
                <h2>Pro</h2>
                <span className="pricing-pill">
                  {isPro ? 'You’re on Pro' : 'AI, in ~30 days'}
                </span>
              </div>
              <p className="pricing-price">
                $10<span> / month</span>
              </p>
              <p className="pricing-price-note">
                Lock the price now. Billing starts the day the AI features go
                live.
              </p>
              <hr />
              <ul>
                {PRO_FEATURES.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {isPro ? (
                <span className="pricing-btn is-fill is-current">
                  Current plan
                </span>
              ) : (
                <a
                  href={proCheckoutHref}
                  className="pricing-btn is-fill"
                  rel="noopener noreferrer"
                >
                  Lock in $10 a month
                </a>
              )}
            </article>

            <article className="pricing-card is-dark">
              <div className="pricing-card-head">
                <h2 className="is-accent">Annual welcome</h2>
                <span className="pricing-pill is-solid">
                  {WELCOME_TOTAL} seats
                </span>
              </div>
              <p className="pricing-price is-light">
                $12<span> / year</span>
              </p>
              <p className="pricing-price-note is-hot">
                Only the next {WELCOME_TOTAL} people pay $12. Price hike once we
                reach the limit
              </p>
              <div
                className="pricing-seats"
                aria-label={`${WELCOME_TAKEN} of ${WELCOME_TOTAL} seats taken`}
              >
                {Array.from({ length: WELCOME_TOTAL }).map((_, i) => (
                  <span
                    key={i}
                    className={i < WELCOME_TAKEN ? 'is-taken' : undefined}
                  />
                ))}
              </div>
              <p className="pricing-seats-label">
                [{WELCOME_TAKEN}] of {WELCOME_TOTAL} taken
              </p>
              <hr />
              <ul>
                {ANNUAL_FEATURES.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link href={joinHref} className="pricing-btn is-fill">
                Take one of the {WELCOME_TOTAL} seats
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="pricing-band pricing-compare">
        <div className="pricing-rail" aria-hidden />
        <div className="pricing-band-inner">
          <div className="pricing-kicker">
            <ArrowMark />
            <span>Line by line</span>
          </div>
          <h2>What each plan actually includes</h2>

          <div className="pricing-table" role="table" aria-label="Plan comparison">
            <div className="pricing-table-row is-head" role="row">
              <span role="columnheader">Feature</span>
              <span role="columnheader">Free</span>
              <span role="columnheader">Pro</span>
              <span role="columnheader" className="is-accent">
                Annual welcome
              </span>
            </div>
            {COMPARE_ROWS.map((row) => (
              <div
                key={row.label}
                className={`pricing-table-row${row.emphasize ? ' is-em' : ''}`}
                role="row"
              >
                <span role="cell">{row.label}</span>
                <span role="cell">
                  <Dot tone={row.free ? 'ink' : 'empty'} />
                </span>
                <span role="cell">
                  <Dot tone={row.pro ? 'ink' : 'empty'} />
                </span>
                <span role="cell">
                  <Dot tone={row.annual ? 'accent' : 'empty'} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pricing-band pricing-team">
        <div className="pricing-rail" aria-hidden />
        <div className="pricing-band-inner pricing-team-inner">
          <ArrowMark className="pricing-team-mark" />
          <div className="pricing-team-copy">
            <h2>Buying for your team?</h2>
            <p>
              Tell us how many of you there are and what you need. We will quote
              it properly rather than multiply a seat price.
            </p>
          </div>
          <a href="mailto:hello@cupkey.io" className="pricing-btn is-fill">
            hello@cupkey.io
          </a>
        </div>
      </section>

      <section className="pricing-band pricing-faq">
        <div className="pricing-rail" aria-hidden />
        <div className="pricing-band-inner">
          <div className="pricing-kicker">
            <ArrowMark />
            <span>Questions</span>
          </div>
          <h2>The things people ask before paying</h2>
          <div className="pricing-faq-grid">
            {FAQS.map((item) => (
              <div key={item.q} className="pricing-faq-item">
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {!embedded ? (
        <section id="signup" className="pricing-band pricing-cta">
          <div className="pricing-rail" aria-hidden />
          <div className="pricing-band-inner pricing-cta-inner">
            <div className="pricing-cta-copy">
              <h2>Start free. Decide about Pro in a month.</h2>
              <p>
                Connect a calendar, set your hours and breaks, write down three
                things. Cupkey does the rest, and tells you when you’re kidding
                yourself.
              </p>
            </div>
            <div className="pricing-cta-actions">
              <Link href={joinHref} className="pricing-btn is-fill is-lg">
                {joinLabel}
              </Link>
              <a href="mailto:hello@cupkey.io" className="pricing-mail-link">
                Still unsure? Ask us anything at hello@cupkey.io
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {!embedded ? (
        <footer className="pricing-foot">
          <CupkeyLogo size={20} title="cupkey.io" />
          <span>Plan the day. Protect the breaks. Measure the truth.</span>
          <div className="pricing-foot-links">
            <Link href="/">Home</Link>
            {!signedIn ? (
              <>
                <Link href="/login">Login</Link>
                <Link href="/login">Sign up</Link>
              </>
            ) : (
              <Link href="/schedule">Open dashboard</Link>
            )}
            <a href="mailto:hello@cupkey.io">hello@cupkey.io</a>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
