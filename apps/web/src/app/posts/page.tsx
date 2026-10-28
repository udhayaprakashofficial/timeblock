'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

/** Legacy /posts → /spotlight */
function PostsRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(qs ? `/spotlight?${qs}` : '/spotlight');
  }, [router, searchParams]);
  return null;
}

export default function PostsRoute() {
  return (
    <Suspense fallback={null}>
      <PostsRedirectInner />
    </Suspense>
  );
}
