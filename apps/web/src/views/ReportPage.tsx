'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EodSheetDto, WeeklyReportDto } from '@timeblock/shared-types';
import { api, formatTimeRange, todayISO } from '../api';
import { EodSheet } from '../components/EodSheet';
import { MeetSourceBadge } from '../components/MeetSourceBadge';

function formatDayLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function statusLabel(status: string) {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress') return 'Live';
  return 'Open';
}

export function ReportPage({ timeZone }: { timeZone?: string | null }) {
  const date = todayISO(timeZone);
  const report = useQuery({
    queryKey: ['weekly', date],
    queryFn: () => api.get<WeeklyReportDto>(`/api/stats/weekly?date=${date}`),
  });
  const eod = useQuery({
    queryKey: ['eod', date],
    queryFn: () => api.get<EodSheetDto>(`/api/stats/eod?date=${date}`),
  });

  const data = report.data;
  const byDay = data?.byDay ?? [];
  const byTask = data?.byTask ?? [];
  const maxBar = Math.max(
    1,
    ...byDay.map((d) => Math.max(d.estimatedMinutes, d.actualMinutes)),
  );
  const delta =
    (data?.totals?.actualMinutes ?? 0) - (data?.totals?.estimatedMinutes ?? 0);

  const weekdayLabels = useMemo(
    () => byDay.map((d) => formatDayLabel(d.date)),
    [byDay],
  );

  return (
    <div className="report-page">
      <div className="schedule-header">
        <div>
          <h1 className="page-title">Weekly report</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {data
              ? `${data.weekStart} → ${data.weekEnd}`
              : 'Estimated vs actual · completion · EOD'}
          </p>
        </div>
      </div>

      <div className="report-hero-stats">
        <div className="report-stat">
          <span className="label">Estimated</span>
          <strong>{data?.totals?.estimatedMinutes ?? 0}m</strong>
        </div>
        <div className="report-stat">
          <span className="label">Actual</span>
          <strong>{data?.totals?.actualMinutes ?? 0}m</strong>
        </div>
        <div className="report-stat">
          <span className="label">Delta</span>
          <strong className={delta > 0 ? 'is-over' : delta < 0 ? 'is-under' : ''}>
            {delta > 0 ? '+' : ''}
            {delta}m
          </strong>
        </div>
        <div className="report-stat accent">
          <span className="label">Completion</span>
          <strong>{data?.totals?.completionPercent ?? 0}%</strong>
          <span className="sub">
            {data?.totals?.completed ?? 0}/{data?.totals?.total ?? 0} tasks
          </span>
        </div>
      </div>

      <EodSheet
        data={eod.data}
        loading={eod.isLoading}
        timeZone={timeZone}
      />

      <section className="report-panel">
        <div className="report-panel-head">
          <h3>Daily breakdown</h3>
          <p>Blue = estimated · Coral = actual · ring = completion</p>
        </div>
        <div className="report-day-grid">
          {byDay.map((d, i) => (
            <div className="report-day-card" key={d.date}>
              <div className="report-day-top">
                <strong>{weekdayLabels[i]}</strong>
                <span
                  className="report-day-ring"
                  style={{ ['--pct' as string]: d.completionPercent }}
                >
                  {d.completionPercent}%
                </span>
              </div>
              <div className="report-day-bars">
                <div className="report-mini-bar">
                  <i
                    className="est"
                    style={{
                      width: `${(d.estimatedMinutes / maxBar) * 100}%`,
                    }}
                  />
                </div>
                <div className="report-mini-bar">
                  <i
                    className="act"
                    style={{
                      width: `${(d.actualMinutes / maxBar) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="report-day-meta">
                <span>{d.estimatedMinutes}m est</span>
                <span>{d.actualMinutes}m act</span>
                <span>
                  {d.completed}/{d.total} done
                </span>
              </div>
            </div>
          ))}
          {byDay.length === 0 && (
            <p className="task-meta">Loading week…</p>
          )}
        </div>
      </section>

      <section className="report-panel">
        <div className="report-panel-head">
          <h3>Task ledger</h3>
          <p>Every task this week with status and variance</p>
        </div>
        <div className="report-table-wrap">
          <table className="report-table modern">
            <thead>
              <tr>
                <th>Date</th>
                <th>Task</th>
                <th>Status</th>
                <th>Window</th>
                <th>Est</th>
                <th>Actual</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {byTask.map((t) => (
                <tr key={t.taskId}>
                  <td>{t.date.slice(5)}</td>
                  <td>
                    <strong>{t.name}</strong>
                    {t.scheduleLocked ? <MeetSourceBadge /> : null}
                  </td>
                  <td>
                    <span className={`status-pill ${t.status}`}>
                      {statusLabel(t.status)}
                    </span>
                  </td>
                  <td className="mono">
                    {formatTimeRange(
                      t.scheduledStart ?? null,
                      t.scheduledEnd ?? null,
                      timeZone,
                    )}
                  </td>
                  <td>{t.estimatedMinutes}m</td>
                  <td>{t.actualMinutes}m</td>
                  <td
                    className={
                      t.varianceMinutes > 0
                        ? 'is-over'
                        : t.varianceMinutes < 0
                          ? 'is-under'
                          : ''
                    }
                  >
                    {t.varianceMinutes > 0 ? '+' : ''}
                    {t.varianceMinutes}m
                  </td>
                </tr>
              ))}
              {byTask.length === 0 && (
                <tr>
                  <td colSpan={7}>No tasks this week yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
