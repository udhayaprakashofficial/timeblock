'use client';

import type { EodSheetDto } from '@timeblock/shared-types';
import { detectBrowserTimeZone, formatTimeRange, parseInstant } from '../api';
import { MeetSourceBadge } from './MeetSourceBadge';

export function EodSheet({
  data,
  loading,
  timeZone,
  compact,
}: {
  data?: EodSheetDto | null;
  loading?: boolean;
  timeZone?: string | null;
  compact?: boolean;
}) {
  if (loading && !data) {
    return (
      <section className={`eod-sheet${compact ? ' is-compact' : ''}`}>
        <div className="eod-head">
          <h3>End of day</h3>
          <p>Loading today’s sheet…</p>
        </div>
      </section>
    );
  }

  const summary = data?.summary;
  const tasks = data?.tasks ?? [];

  return (
    <section className={`eod-sheet${compact ? ' is-compact' : ''}`}>
      <div className="eod-head">
        <div>
          <h3>End of day sheet</h3>
          <p>
            {data?.date ?? 'Today'} · generated{' '}
            {data?.generatedAt
              ? parseInstant(data.generatedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: timeZone?.trim() || detectBrowserTimeZone(),
                })
              : '—'}
          </p>
        </div>
        <div className="eod-score">
          <strong>{summary?.completionPercent ?? 0}%</strong>
          <span>complete</span>
        </div>
      </div>

      {summary && summary.total > 0 ? (
        <p className="eod-appreciate">
          {summary.completionPercent >= 100
            ? 'Day closed. Every task on record — great work for future you.'
            : summary.completionPercent >= 60
              ? 'Solid progress today. Your EOD sheet keeps this for weekly review.'
              : 'Keep finishing what you scheduled — each Done feeds your badges and reports.'}
        </p>
      ) : null}

      <div className="eod-summary-row">
        <div>
          <span className="label">Shipped</span>
          <strong>{summary?.completed ?? 0}</strong>
        </div>
        <div>
          <span className="label">Remaining</span>
          <strong>{summary?.pending ?? 0}</strong>
        </div>
        <div>
          <span className="label">Live</span>
          <strong>{summary?.inProgress ?? 0}</strong>
        </div>
        <div>
          <span className="label">Est / Act</span>
          <strong>
            {summary?.estimatedMinutes ?? 0}m / {summary?.actualMinutes ?? 0}m
          </strong>
        </div>
      </div>

      {!compact && (
        <div className="eod-lists">
          <div>
            <h4>Shipped</h4>
            {(data?.shipped ?? []).length ? (
              <ul>
                {(data?.shipped ?? []).map((name) => (
                  <li key={`s-${name}`}>{name}</li>
                ))}
              </ul>
            ) : (
              <p className="task-meta">Nothing marked done yet.</p>
            )}
          </div>
          <div>
            <h4>Carry forward</h4>
            {(data?.remaining ?? []).length ? (
              <ul>
                {(data?.remaining ?? []).map((name) => (
                  <li key={`r-${name}`}>{name}</li>
                ))}
              </ul>
            ) : (
              <p className="task-meta">All clear for tomorrow.</p>
            )}
          </div>
        </div>
      )}

      <div className="eod-table-wrap">
        <table className="report-table modern eod-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Window</th>
              <th>Est</th>
              <th>Act</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className={t.status === 'completed' ? 'is-done' : ''}>
                <td>
                  <strong>{t.name}</strong>
                  {t.scheduleLocked ? (
                    <MeetSourceBadge meetLink={t.meetLink} />
                  ) : null}
                </td>
                <td>
                  <span className={`status-pill ${t.status}`}>
                    {t.status === 'completed'
                      ? 'Done'
                      : t.status === 'in_progress'
                        ? 'Live'
                        : 'Open'}
                  </span>
                </td>
                <td className="mono">
                  {formatTimeRange(
                    t.scheduledStart,
                    t.scheduledEnd,
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
            {tasks.length === 0 && (
              <tr>
                <td colSpan={6}>No tasks logged for today.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
