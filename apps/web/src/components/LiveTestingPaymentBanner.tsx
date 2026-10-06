'use client';

/**
 * TEMPORARY — ₹1 live Dodo payment smoke test.
 * Remove this file + CSS + AppRoot mount when told.
 * Gated by server env LIVE_TESTING_PAYMENT + DODO_LIVE_TESTING_PRODUCT_ID.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../api';
import {
  buildLiveTestingCheckoutUrl,
  catalogFromApi,
} from '../lib/billing';

export function LiveTestingPaymentBanner({ user }: { user: UserDto }) {
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
    staleTime: 60_000,
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

  if (!catalog.liveTestingPayment || !href) return null;

  return (
    <div className="live-test-pay-banner" role="status">
      <div className="live-test-pay-banner-copy">
        <span className="live-test-pay-banner-tag">Live test</span>
        <strong>₹1 payment check</strong>
        <span className="live-test-pay-banner-note">
          Temporary — verifies live Dodo checkout only. Does not unlock Pro.
        </span>
      </div>
      <a className="live-test-pay-banner-cta" href={href}>
        Pay ₹1 →
      </a>
    </div>
  );
}
