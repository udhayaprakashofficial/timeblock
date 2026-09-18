import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Schedule',
  description: 'Your Timeblock calendar and priority list for today.',
  robots: { index: false, follow: false },
};

export default function ScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
