'use client';

import { useQuery } from '@tanstack/react-query';
import type { StatsOverviewDto } from '@timeblock/shared-types';
import { api, todayISO } from '../api';
import { EffortBadges } from '../components/EffortBadges';

export function BadgesPage({ timeZone }: { timeZone?: string | null }) {
  const date = todayISO(timeZone);
  const stats = useQuery({
    queryKey: ['stats', date],
    queryFn: () =>
      api.get<StatsOverviewDto>(`/api/stats/overview?date=${date}`),
  });

  return (
    <div className="badges-page">
      <div className="schedule-header">
        <div>
          <h1 className="page-title">Effort badges</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Unlock challenges with daily learning, consistency streaks, focus,
            and AI-style intentional work — your history stays for reports.
          </p>
        </div>
      </div>

      <section className="badges-panel">
        <EffortBadges effort={stats.data?.effort} />
      </section>
    </div>
  );
}
