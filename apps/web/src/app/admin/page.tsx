'use client';

import { useQuery } from '@tanstack/react-query';
import type { UserDto } from '@timeblock/shared-types';
import { api } from '../../api';
import { AdminPage } from '../../views/AdminPage';

const ADMIN_EMAIL = 'udhayaprakashmohan@gmail.com';

export default function AdminRoutePage() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<UserDto | null>('/api/users/me');
      } catch {
        return null;
      }
    },
  });

  if (me.isLoading) {
    return (
      <div className="admin-page">
        <p>Loading…</p>
      </div>
    );
  }

  if (!me.data || me.data.email.trim().toLowerCase() !== ADMIN_EMAIL) {
    return (
      <div className="admin-page">
        <h1>Admin</h1>
        <p>You don’t have access to this page.</p>
      </div>
    );
  }

  return <AdminPage />;
}
