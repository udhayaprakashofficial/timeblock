'use client';

/**
 * TEMPORARY — ₹1 live Dodo payment smoke test.
 * Remove this file + CSS + AppRoot/Subscription mounts when told.
 * UI is force-shown until removal; Pay ₹1 needs DODO_LIVE_TESTING_PRODUCT_ID on server.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../api';
import {
  buildLiveTestingCheckoutUrl,
  catalogFromApi,
} from '../lib/billing';

/** TEMPORARY — keep UI visible even if server config is stale. */
const FORCE_SHOW_LIVE_TEST_UI = true;

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

  const enabled =
    FORCE_SHOW_LIVE_TEST_UI || catalog.liveTestingPayment === true;

  if (!enabled) return null;

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
            Set <code>DODO_LIVE_TESTING_PRODUCT_ID</code> on the API server
            (Vercel), then redeploy.
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
            : 'Set DODO_LIVE_TESTING_PRODUCT_ID on the API server, then redeploy.'}
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
