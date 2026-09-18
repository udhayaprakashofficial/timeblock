'use client';

import { SettingsPage } from '../../views/SettingsPage';
import { useAppUserOptional } from '../../user-context';

export default function SettingsRoute() {
  const user = useAppUserOptional();
  if (!user) return null;
  return <SettingsPage user={user} />;
}
