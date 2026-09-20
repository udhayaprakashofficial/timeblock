'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { todayISO } from '../api';
import { EffortBadges } from '../components/EffortBadges';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchStats, hydrateStatsFromCache } from '../store/statsSlice';

export function BadgesPage({ timeZone }: { timeZone?: string | null }) {
  const date = todayISO(timeZone);
  const dispatch = useAppDispatch();
  const qc = useQueryClient();
  const stats = useAppSelector((s) => s.stats.byDate[date]);
  const status = useAppSelector((s) => s.stats.statusByDate[date] ?? 'idle');

  useEffect(() => {
    dispatch(hydrateStatsFromCache(date));
    void dispatch(fetchStats(date)).then((action) => {
      if (fetchStats.fulfilled.match(action)) {
        qc.setQueryData(['stats', date], action.payload.stats);
      }
    });
  }, [date, dispatch, qc]);

  const loading = !stats && (status === 'loading' || status === 'idle');

  return (
    <div className="badges-page">
      <header className="badges-topbar">
        <div>
          <h1 className="page-title">Badges</h1>
          <p className="badges-sub">Earn proof from real tracked work.</p>
        </div>
      </header>

      <section className="badges-panel">
        <EffortBadges effort={stats?.effort} loading={loading} />
      </section>
    </div>
  );
}
