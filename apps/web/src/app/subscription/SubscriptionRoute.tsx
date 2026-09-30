'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import '../../views/subscription.css';

/** Legacy /subscription → Settings → Subscription (keeps checkout return query). */
export function SubscriptionRoute() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('panel', 'subscription');
    const qs = params.toString();
    router.replace(`/settings?${qs}${window.location.hash || ''}`);
  }, [router]);

  return (
    <div className="sub-page">
      <p className="sub-empty">Opening subscription…</p>
    </div>
  );
}
