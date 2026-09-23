import type { Metadata } from 'next';
import { PricingRoute } from './PricingRoute';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'The Cupkey planner is free forever. Pro locks AI receipts and work history — billing starts when those features ship.',
};

export default function PricingPageRoute() {
  return <PricingRoute />;
}
