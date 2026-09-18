'use client';

import { TodayTasksPage } from '../../views/TodayTasksPage';
import { useAppUserOptional } from '../../user-context';

export default function TodayRoute() {
  const user = useAppUserOptional();
  if (!user) return null;
  return <TodayTasksPage timeZone={user.timezone} />;
}
