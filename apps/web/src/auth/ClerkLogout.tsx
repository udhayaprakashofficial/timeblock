'use client';

import { useClerk } from '@clerk/clerk-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/** Isolated module so Clerk hooks share the same React instance as the app. */
export function ClerkLogout({ onLoggedOut }: { onLoggedOut: () => void }) {
  const qc = useQueryClient();
  const { signOut } = useClerk();
  return (
    <button
      className="btn btn-ghost"
      type="button"
      onClick={() => {
        void api
          .post('/api/auth/logout')
          .catch(() => undefined)
          .finally(() => {
            void signOut({ redirectUrl: '/' });
            qc.setQueryData(['me'], null);
            onLoggedOut();
          });
      }}
      style={{ justifyContent: 'flex-start', paddingLeft: 4 }}
    >
      ↩ Logout
    </button>
  );
}
