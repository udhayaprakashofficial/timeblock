'use client';

import { TodayPage } from '../../views/TodayPage';
import { useAppUserOptional } from '../../user-context';

export default function ScheduleRoute() {
  const user = useAppUserOptional();
  if (!user) return null;
  return (
    <TodayPage
      timeZone={user.timezone}
      defaultTaskMinutes={user.defaultTaskMinutes ?? 30}
    />
  );
}
