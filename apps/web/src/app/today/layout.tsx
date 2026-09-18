import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Today',
  description: 'Today’s metrics and assigned tasks.',
  robots: { index: false, follow: false },
};

export default function TodayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
