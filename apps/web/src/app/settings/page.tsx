'use client';

import { Suspense } from 'react';
import { SettingsPage } from '../../views/SettingsPage';
import { useAppUserOptional } from '../../user-context';

export default function SettingsRoute() {
  const user = useAppUserOptional();
  if (!user) return null;
  return (
    <Suspense fallback={null}>
      <SettingsPage user={user} />
    </Suspense>
  );
}
