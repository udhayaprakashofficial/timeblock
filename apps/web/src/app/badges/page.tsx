'use client';

import { BadgesPage } from '../../views/BadgesPage';
import { useAppUserOptional } from '../../user-context';

export default function BadgesRoute() {
  const user = useAppUserOptional();
  if (!user) return null;
  return <BadgesPage timeZone={user.timezone} />;
}
