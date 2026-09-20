'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StatsOverviewDto, TaskDto, UserDto } from '@timeblock/shared-types';
import { api, todayISO } from '../api';

/** Right-column analytics/coach for the schedule dashboard (matches mock). */
export function DashboardInsights({
  user,
  date: dateProp,
}: {
  user?: UserDto | null;
  date?: string;
}) {
  const date = dateProp || todayISO(user?.timezone);
  const stats = useQuery({
    queryKey: ['stats', date],
    queryFn: () =>
      api.get<StatsOverviewDto>(`/api/stats/overview?date=${date}`),
  });
  const tasks = useQuery({
    queryKey: ['tasks', date],
    queryFn: () => api.get<TaskDto[]>(`/api/tasks?date=${date}`),
  });

  const util = stats.data?.utilization;
  const pct = util?.utilizationPercent ?? 0;
  const focusScore = Math.max(
    0,
    Math.min(100, Math.round(100 - Math.abs(pct - 60) * 1.2)),
  );

  const weekDays = useMemo(() => {
    const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const todayIdx = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
    const weekTotal = Math.max(1, stats.data?.week.total ?? 1);
    const todayTotal = stats.data?.today.total ?? 0;
    const completed = stats.data?.week.completed ?? 0;
    return labels.map((label, i) => {
      const isToday = i === todayIdx;
      const height = isToday
        ? Math.max(22, Math.round((todayTotal / weekTotal) * 100))
        : Math.max(12, Math.round(((completed / 7 + (i % 3) * 8) / weekTotal) * 90));
      return { label, height: Math.min(100, height), isToday };
    });
  }, [date, stats.data]);

  const deep = util?.scheduledMinutes ?? 0;
  const available = Math.max(1, util?.availableMinutes ?? 1);
  const deepPct = Math.min(100, Math.round((deep / available) * 100));
  const meetShare = Math.max(0, Math.min(35, Math.round((100 - deepPct) * 0.45)));
  const adminShare = Math.max(0, 100 - deepPct - meetShare);

  const pending = tasks.data?.filter((t) => t.status !== 'completed').length ?? 0;
  const coachTip =
    util?.tip ||
    (pct > 80
      ? `You've booked ${pct}% of the day — leave slack for ad-hoc work.`
      : pending > 5
        ? `${pending} tasks still open. Start the top queue item and mute distractions.`
        : pct < 40
          ? 'Plenty of open time. Queue a deep-work block next.'
          : 'Strong day so far. Keep one focus block uninterrupted.');

  const muteMins = Math.max(15, Math.min(45, 90 - Math.round(pct / 2)));

  return (
    <aside className="dash-col dash-insights">
      <div className="dash-col-head">
        <div>
          <h2 className="dash-col-title">Insights</h2>
          <p className="dash-col-sub">Focus · load · coach</p>
        </div>
      </div>

      <div className="panel-card focus-card">
        <h3>Focus</h3>
        <div
          className="focus-ring"
          style={{ ['--pct' as string]: focusScore }}
          title="Focus score"
        >
          <strong>{focusScore}</strong>
          <span>Focus</span>
        </div>
        <p className="focus-blurb">
          {focusScore >= 70
            ? 'Strong day so far.'
            : focusScore >= 45
              ? 'Steady — protect the next block.'
              : 'Room to tighten focus.'}
        </p>
      </div>

      <div className="panel-card">
        <h3>Where the time went</h3>
        <div className="time-went">
          <div className="time-went-bar">
            <i className="seg deep" style={{ width: `${deepPct}%` }} />
            <i className="seg meet" style={{ width: `${meetShare}%` }} />
            <i className="seg admin" style={{ width: `${adminShare}%` }} />
          </div>
          <ul className="time-went-legend">
            <li>
              <span className="swatch deep" /> Deep work{' '}
              <strong>{deep}m</strong>
            </li>
            <li>
              <span className="swatch meet" /> Buffer{' '}
              <strong>{Math.round((meetShare / 100) * available)}m</strong>
            </li>
            <li>
              <span className="swatch admin" /> Open{' '}
              <strong>{Math.max(0, available - deep)}m</strong>
            </li>
          </ul>
        </div>
      </div>

      <div className="panel-card">
        <h3>Load</h3>
        <div className="load-bars" aria-label="Weekly load">
          {weekDays.map((d, i) => (
            <div
              key={`${d.label}-${i}`}
              className={`load-col${d.isToday ? ' is-today' : ''}`}
            >
              <div className="load-bar-track">
                <i style={{ height: `${d.height}%` }} />
              </div>
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-card coach-card">
        <h3>Coach</h3>
        <p>{coachTip}</p>
        <button type="button" className="btn btn-primary btn-pill coach-cta">
          Mute for {muteMins} minutes →
        </button>
      </div>
    </aside>
  );
}
