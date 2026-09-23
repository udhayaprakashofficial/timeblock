'use client';

import { useQuery } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../../api';
import { PricingPage } from '../../views/PricingPage';
import { SubscriptionPage } from '../../views/SubscriptionPage';
import '../../views/subscription.css';

/** Signed-in → account status. Signed-out → marketing pricing. */
export function PricingRoute() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<UserDto | null>('/api/users/me');
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  if (me.isLoading) {
    return (
      <div className="sub-page">
        <p className="sub-empty">Loading subscription…</p>
      </div>
    );
  }

  if (me.data) {
    return <SubscriptionPage user={me.data} />;
  }

  return <PricingPage signedIn={false} user={null} embedded={false} />;
}
