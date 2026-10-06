'use client';

/**
 * TEMPORARY — ₹1 live Dodo payment smoke test.
 * Remove this file + CSS + AppRoot/Subscription mounts when told.
 * Gated by server env LIVE_TESTING_PAYMENT (+ DODO_LIVE_TESTING_PRODUCT_ID for checkout).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../api';
import {
  buildLiveTestingCheckoutUrl,
  catalogFromApi,
} from '../lib/billing';

export function LiveTestingPaymentBanner({
  user,
  variant = 'banner',
}: {
  user: UserDto;
  /** banner = strip; card = subscription plan-style card */
  variant?: 'banner' | 'card';
}) {
  const configQ = useQuery({
    queryKey: ['billing-config'],
    queryFn: () =>
      api.get<{
        proProductId: string;
        annualWelcomeProductId: string;
        checkoutBase?: string;
        liveTestingPayment?: boolean;
        liveTestingProductId?: string;
      }>('/api/billing/config'),
    staleTime: 30_000,
  });

  const catalog = useMemo(
    () => catalogFromApi(configQ.data),
    [configQ.data],
  );

  const href = useMemo(
    () =>
      buildLiveTestingCheckoutUrl(catalog, {
        id: user.id,
        email: user.email,
        name: user.name,
      }),
    [catalog, user.id, user.email, user.name],
  );

  if (!configQ.isSuccess) return null;
  if (!catalog.liveTestingPayment) return null;

  const ready = Boolean(href);

  if (variant === 'card') {
    return (
      <article className="sub-plan-card live-test-pay-card">
        <div className="sub-plan-card-head">
          <h4>₹1 live test</h4>
          <span className="sub-plan-pill is-solid">Temporary</span>
        </div>
        <p className="sub-plan-price">
          ₹1<span> / once</span>
        </p>
        <p className="sub-plan-blurb">
          Smoke-test live Dodo checkout. Does not unlock Pro.
        </p>
        {ready ? (
          <a
            href={href}
            className="sub-btn is-primary"
            rel="noopener noreferrer"
          >
            Pay ₹1 →
          </a>
        ) : (
          <p className="live-test-pay-missing">
            Set <code>DODO_LIVE_TESTING_PRODUCT_ID</code> on the server, then
            redeploy.
          </p>
        )}
      </article>
    );
  }

  return (
    <div className="live-test-pay-banner" role="status">
      <div className="live-test-pay-banner-copy">
        <span className="live-test-pay-banner-tag">Live test</span>
        <strong>₹1 payment check</strong>
        <span className="live-test-pay-banner-note">
          {ready
            ? 'Temporary — verifies live Dodo checkout only. Does not unlock Pro.'
            : 'LIVE_TESTING_PAYMENT is on, but DODO_LIVE_TESTING_PRODUCT_ID is missing on the server.'}
        </span>
      </div>
      {ready ? (
        <a className="live-test-pay-banner-cta" href={href}>
          Pay ₹1 →
        </a>
      ) : (
        <span className="live-test-pay-banner-cta is-disabled">Pay ₹1</span>
      )}
    </div>
  );
}
