'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WeeklyReportDto } from '@timeblock/shared-types';
import { api, todayISO } from '../api';
import { HintMark } from '../components/ui-hints';
import { CupkeyLogo } from '../components/CupkeyLogo';
import { ShareStudio } from '../components/share/ShareStudio';
import { ExportIcon, ShareIcon } from '../components/share/ShareIcons';
import type { ShareWeekPayload } from '../components/share/shareFormat';
import {
  formatDrift,
  formatHm,
  formatWeekSpan,
  isoWeekNumber,
  weekdayShort,
} from '../components/share/shareFormat';

function dayInsight(byDay: WeeklyReportDto['byDay']): string {
  if (!byDay.length) {
    return 'Finish a few blocks this week and Cupkey will narrate the shape of it.';
  }
  const ranked = [...byDay].sort((a, b) => b.actualMinutes - a.actualMinutes);
  const best = ranked[0];
  const soft = ranked[ranked.length - 1];
  const bestLabel = weekdayShort(best.date);
  const softLabel = weekdayShort(soft.date);
  if (best.actualMinutes <= 0) {
    return 'No logged minutes yet this week — start a block and the ledger fills in.';
  }
  return `${bestLabel.slice(0, 1)}${bestLabel.slice(1).toLowerCase()} was your monster: ${formatHm(best.actualMinutes)} logged. ${softLabel.slice(0, 1)}${softLabel.slice(1).toLowerCase()} you scheduled ${formatHm(soft.estimatedMinutes)} and did ${formatHm(soft.actualMinutes)}.`;
}

function accuracyPercent(report: WeeklyReportDto): number {
  const est = report.totals.estimatedMinutes;
  if (est <= 0) return 100;
  const drift = Math.abs(report.totals.actualMinutes - est);
  return Math.max(0, Math.min(100, Math.round((1 - drift / est) * 100)));
}

function carriedTasks(report: WeeklyReportDto): number {
  return report.byTask.filter((t) => t.status !== 'completed').length;
}

export function ReportPage({ timeZone }: { timeZone?: string | null }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);

  const anchor = useMemo(() => {
    const base = todayISO(timeZone);
    if (!weekOffset) return base;
    const d = new Date(`${base}T12:00:00`);
    d.setDate(d.getDate() + weekOffset * 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, [timeZone, weekOffset]);

  const report = useQuery({
    queryKey: ['weekly', anchor],
    queryFn: () => api.get<WeeklyReportDto>(`/api/stats/weekly?date=${anchor}`),
  });

  const data = report.data;
  const byDay = data?.byDay ?? [];
  const byTask = data?.byTask ?? [];
  const maxBar = Math.max(
    1,
    ...byDay.map((d) => Math.max(d.estimatedMinutes, d.actualMinutes)),
  );
  const drift =
    (data?.totals?.actualMinutes ?? 0) - (data?.totals?.estimatedMinutes ?? 0);
  const weekNo = data ? isoWeekNumber(data.weekStart) : isoWeekNumber(anchor);
  const weekSpan = data
    ? formatWeekSpan(data.weekStart, data.weekEnd)
    : '…';
  const acc = data ? accuracyPercent(data) : 0;

  const shareWeek: ShareWeekPayload | null = data
    ? {
        weekStart: data.weekStart,
        weekEnd: data.weekEnd,
        weekLabel: `Week ${weekNo} · ${weekSpan}`,
        estimatedMinutes: data.totals.estimatedMinutes,
        actualMinutes: data.totals.actualMinutes,
        driftMinutes: drift,
        completed: data.totals.completed,
        total: data.totals.total,
        completionPercent: data.totals.completionPercent,
        accuracyPercent: acc,
        days: byDay.map((d) => ({
          date: d.date,
          label: weekdayShort(d.date),
          estimatedMinutes: d.estimatedMinutes,
          actualMinutes: d.actualMinutes,
        })),
        streakDays: Math.min(
          7,
          byDay.filter((d) => d.completed > 0).length,
        ),
      }
    : null;

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ['Task', 'Day', 'Est (m)', 'Act (m)', 'Delta (m)', 'Status'],
      ...data.byTask.map((t) => [
        t.name,
        weekdayShort(t.date),
        String(t.estimatedMinutes),
        String(t.actualMinutes),
        String(t.varianceMinutes),
        t.status,
      ]),
    ];
    const csv = rows
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cupkey-week-${weekNo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="report-kit">
      <header className="report-kit-head">
        <div className="report-kit-brand">
          <CupkeyLogo size={26} />
          <h1>
            Week {weekNo} · {weekSpan}
            <HintMark id="report.delta" placement="bottom" />
          </h1>
        </div>
        <div className="report-kit-seg" role="tablist" aria-label="Week">
          <button
            type="button"
            role="tab"
            aria-selected={weekOffset === 0}
            className={weekOffset === 0 ? 'is-active' : ''}
            onClick={() => setWeekOffset(0)}
          >
            This week
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={weekOffset === -1}
            className={weekOffset === -1 ? 'is-active' : ''}
            onClick={() => setWeekOffset(-1)}
          >
            Last week
          </button>
        </div>
        <button
          type="button"
          className="btn btn-outline"
          disabled={!data}
          onClick={exportCsv}
        >
          <ExportIcon size={15} />
          Export CSV
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!data}
          onClick={() => setShareOpen(true)}
        >
          <ShareIcon size={15} />
          Share recap
        </button>
      </header>

      <div className="report-kit-stats">
        <div>
          <span>Estimated</span>
          <strong>{formatHm(data?.totals?.estimatedMinutes ?? 0)}</strong>
        </div>
        <div>
          <span>Actual</span>
          <strong>{formatHm(data?.totals?.actualMinutes ?? 0)}</strong>
        </div>
        <div>
          <span>Drift</span>
          <strong className="is-hot">{formatDrift(drift)}</strong>
        </div>
        <div className="is-ink">
          <span>Completion</span>
          <strong className="is-flare">
            {data?.totals?.completionPercent ?? 0}%
          </strong>
        </div>
      </div>

      <div className="report-kit-body">
        <section className="report-kit-breakdown">
          <div className="report-kit-section-head">
            <h2>Daily breakdown</h2>
            <span>Solid = estimated · outline = actual</span>
          </div>
          <div className="report-kit-chart" role="img" aria-label="Estimated versus actual by day">
            {byDay.map((d) => {
              const estH = Math.round((d.estimatedMinutes / maxBar) * 100);
              const actH = Math.round((d.actualMinutes / maxBar) * 100);
              const label = weekdayShort(d.date);
              const isPeak =
                d.actualMinutes ===
                Math.max(0, ...byDay.map((x) => x.actualMinutes));
              return (
                <div
                  key={d.date}
                  className={`report-kit-col${isPeak && d.actualMinutes > 0 ? ' is-peak' : ''}`}
                >
                  <div className="report-kit-pair">
                    <i className="est" style={{ height: `${estH}%` }} title={`${formatHm(d.estimatedMinutes)} est`} />
                    <i className="act" style={{ height: `${actH}%` }} title={`${formatHm(d.actualMinutes)} act`} />
                  </div>
                  <span>{label.slice(0, 3)}</span>
                </div>
              );
            })}
            {byDay.length === 0 ? (
              <p className="report-kit-empty">
                {report.isLoading ? 'Loading week…' : 'No days yet.'}
              </p>
            ) : null}
          </div>
          <p className="report-kit-insight">{dayInsight(byDay)}</p>
        </section>

        <section className="report-kit-ledger">
          <h2>Task ledger</h2>
          <div className="report-kit-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Day</th>
                  <th>Est</th>
                  <th>Act</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {byTask.slice(0, 12).map((t) => (
                  <tr key={t.taskId}>
                    <td>
                      <strong>{t.name}</strong>
                    </td>
                    <td>{weekdayShort(t.date).slice(0, 3)}</td>
                    <td>{t.estimatedMinutes}m</td>
                    <td>{t.actualMinutes}m</td>
                    <td
                      className={
                        t.varianceMinutes < 0
                          ? 'is-hot'
                          : t.varianceMinutes > 0
                            ? 'is-over'
                            : ''
                      }
                    >
                      {t.varianceMinutes > 0 ? '+' : ''}
                      {t.varianceMinutes}
                    </td>
                  </tr>
                ))}
                {byTask.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No tasks this week yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="report-kit-foot">
            <div>
              <span>Carried forward</span>
              <strong>{data ? carriedTasks(data) : 0} tasks</strong>
            </div>
            <div>
              <span>Avg. accuracy</span>
              <strong className="is-hot">{acc}%</strong>
            </div>
          </div>
        </section>
      </div>

      <ShareStudio
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        week={shareWeek}
        initialTab="linkedin"
      />
    </div>
  );
}
