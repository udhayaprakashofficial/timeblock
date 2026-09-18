'use client';

import { ReportPage } from '../../views/ReportPage';
import { useAppUserOptional } from '../../user-context';

export default function ReportRoute() {
  const user = useAppUserOptional();
  if (!user) return null;
  return <ReportPage timeZone={user.timezone} />;
}
