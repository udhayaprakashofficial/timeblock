'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/clerk-react';
import { App } from './AppRoot';
import { StoreProvider } from './store/StoreProvider';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 30 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? '';

  const tree = (
    <StoreProvider>
      <QueryClientProvider client={queryClient}>
        <App>{children}</App>
      </QueryClientProvider>
    </StoreProvider>
  );

  if (clerkKey) {
    return (
      <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/">
        {tree}
      </ClerkProvider>
    );
  }

  return tree;
}
