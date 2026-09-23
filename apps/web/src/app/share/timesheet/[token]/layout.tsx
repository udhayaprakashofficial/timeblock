import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared timesheet · Cupkey',
  description: 'View-only Cupkey daily timesheet',
};

export default function SharedTimesheetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
