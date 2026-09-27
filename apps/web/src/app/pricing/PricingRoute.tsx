'use client';

import { useQuery } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../../api';
import { PricingPage } from '../../views/PricingPage';

/** Marketing pricing — all plans (Free, Pro, Annual welcome). */
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

  return (
    <PricingPage
      signedIn={Boolean(me.data)}
      user={me.data ?? null}
      embedded={false}
    />
  );
}
