'use client';

import { TimesheetPage } from '../../views/TimesheetPage';
import { useAppUserOptional } from '../../user-context';

export default function TimesheetRoute() {
  const user = useAppUserOptional();
  if (!user) return null;
  return <TimesheetPage user={user} timeZone={user.timezone} />;
}
