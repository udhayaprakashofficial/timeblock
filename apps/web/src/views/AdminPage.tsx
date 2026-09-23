'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import './admin.css';

type Payer = {
  id: string;
  name: string;
  email: string;
  plan: string;
  planStatus: string | null;
  proPaidAt: string | null;
  proActivatedAt: string | null;
  dodoPaymentId: string | null;
};

type PayersResponse = {
  payers: Payer[];
  pendingCount: number;
  activeCount: number;
};

function fmt(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '—';
  }
}

export function AdminPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const payers = useQuery({
    queryKey: ['admin-pro-payers'],
    queryFn: () => api.get<PayersResponse>('/api/admin/pro-payers'),
  });

  const activate = useMutation({
    mutationFn: (body: { allPending?: boolean; userId?: string }) =>
      api.post<{
        activatedCount: number;
        emailsSent: number;
        activatedAt: string;
      }>('/api/admin/activate-pro', body),
    onSuccess: async (data) => {
      setErr(null);
      setMsg(
        `Activated ${data.activatedCount} user(s). Emails sent: ${data.emailsSent}. Countdown starts ${new Date(data.activatedAt).toLocaleDateString()}.`,
      );
      await qc.invalidateQueries({ queryKey: ['admin-pro-payers'] });
    },
    onError: (e) => {
      setMsg(null);
      setErr(e instanceof Error ? e.message : 'Activation failed');
    },
  });

  const rows = payers.data?.payers ?? [];

  return (
    <div className="admin-page">
      <header className="admin-head">
        <p className="admin-kicker">Admin</p>
        <h1>Pro payers</h1>
        <p className="admin-lede">
          Users who locked Pro pricing. When AI features go live, activate
          everyone — they get an email and the subscription countdown starts
          that day.
        </p>
      </header>

      <section className="admin-stats">
        <div>
          <span>Pending</span>
          <strong>{payers.data?.pendingCount ?? '—'}</strong>
        </div>
        <div>
          <span>Active</span>
          <strong>{payers.data?.activeCount ?? '—'}</strong>
        </div>
        <div>
          <span>Total paid</span>
          <strong>{rows.length}</strong>
        </div>
      </section>

      <div className="admin-toolbar">
        <button
          type="button"
          className="admin-btn is-primary"
          disabled={activate.isPending || (payers.data?.pendingCount ?? 0) < 1}
          onClick={() => {
            if (
              !window.confirm(
                'Activate Pro for all pending payers? They will receive an email and countdown starts today.',
              )
            ) {
              return;
            }
            activate.mutate({ allPending: true });
          }}
        >
          {activate.isPending
            ? 'Activating…'
            : 'Activate Pro for all pending'}
        </button>
        <button
          type="button"
          className="admin-btn is-ghost"
          onClick={() => void payers.refetch()}
        >
          Refresh
        </button>
      </div>

      {msg ? <p className="admin-msg">{msg}</p> : null}
      {err ? (
        <p className="admin-err" role="alert">
          {err}
        </p>
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Paid</th>
              <th>Activated</th>
              <th>Payment</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payers.isLoading ? (
              <tr>
                <td colSpan={6}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>No Pro payments yet.</td>
              </tr>
            ) : (
              rows.map((p) => {
                const pending =
                  p.planStatus !== 'active' || !p.proActivatedAt;
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <span className="admin-email">{p.email}</span>
                    </td>
                    <td>
                      <span
                        className={`admin-pill${
                          pending ? ' is-pending' : ' is-active'
                        }`}
                      >
                        {pending ? p.planStatus || 'pending' : 'active'}
                      </span>
                    </td>
                    <td>{fmt(p.proPaidAt)}</td>
                    <td>{fmt(p.proActivatedAt)}</td>
                    <td className="admin-mono">
                      {p.dodoPaymentId || '—'}
                    </td>
                    <td>
                      {pending ? (
                        <button
                          type="button"
                          className="admin-btn is-outline"
                          disabled={activate.isPending}
                          onClick={() =>
                            activate.mutate({ userId: p.id })
                          }
                        >
                          Activate
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
