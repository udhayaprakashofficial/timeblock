import type { Metadata } from 'next';
import { SubscriptionRoute } from './SubscriptionRoute';

export const metadata: Metadata = {
  title: 'Subscription',
  description: 'Your Cupkey plan, Pro status, and invoices.',
};

export default function SubscriptionPageRoute() {
  return <SubscriptionRoute />;
}
