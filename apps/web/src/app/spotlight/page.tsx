'use client';

import { Suspense } from 'react';
import { PostsPage } from '../../views/PostsPage';
import { useAppUserOptional } from '../../user-context';

function SpotlightRouteInner() {
  const user = useAppUserOptional();
  if (!user) return null;
  return <PostsPage timeZone={user.timezone} />;
}

export default function SpotlightRoute() {
  return (
    <Suspense fallback={null}>
      <SpotlightRouteInner />
    </Suspense>
  );
}
