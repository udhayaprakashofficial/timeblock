'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../../api';
import { SubscriptionPage } from '../../views/SubscriptionPage';
import '../../views/subscription.css';

/** Signed-in account plan, payment status, and invoices. */
export function SubscriptionRoute() {
  const router = useRouter();
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

  useEffect(() => {
    if (me.isLoading) return;
    if (!me.data) {
      router.replace('/login?returnTo=%2Fsubscription');
    }
  }, [me.isLoading, me.data, router]);

  if (me.isLoading) {
    return (
      <div className="sub-page">
        <p className="sub-empty">Loading subscription…</p>
      </div>
    );
  }

  if (!me.data) {
    return (
      <div className="sub-page">
        <p className="sub-empty">Redirecting to sign in…</p>
      </div>
    );
  }

  return <SubscriptionPage user={me.data} />;
}
