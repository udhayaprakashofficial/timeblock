'use client';

import { useState } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { UiTooltip } from '../components/ui-hints/UiTooltip';

/** Isolated module so Clerk hooks share the same React instance as the app. */
export function ClerkLogout({ onLoggedOut }: { onLoggedOut: () => void }) {
  const qc = useQueryClient();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* still clear local + Clerk session */
    } finally {
      qc.setQueryData(['me'], null);
      void qc.cancelQueries({ queryKey: ['me'] });
      onLoggedOut();
      try {
        await signOut({ redirectUrl: '/login' });
      } catch {
        /* AppRoot already routed to /login */
      }
      setBusy(false);
    }
  };

  return (
    <UiTooltip label="Log out" placement="right" className="nav-tip-wrap">
      <button
        className="btn btn-ghost sidebar-logout"
        type="button"
        aria-label="Log out"
        disabled={busy}
        onClick={() => void logout()}
      >
        <span className="nav-icon" aria-hidden>
          ↩
        </span>
      </button>
    </UiTooltip>
  );
}
