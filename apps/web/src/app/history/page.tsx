'use client';

import { HistoryPage } from '../../views/HistoryPage';
import { useAppUserOptional } from '../../user-context';

export default function HistoryRoute() {
  const user = useAppUserOptional();
  if (!user) return null;
  return <HistoryPage timeZone={user.timezone} />;
}
