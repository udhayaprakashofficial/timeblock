'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EodSheetDto, TaskDto, UserDto } from '@timeblock/shared-types';
import {
  api,
  shiftDateISO,
  todayISO,
} from '../api';
import { MeetSourceBadge } from '../components/MeetSourceBadge';
import { useTheme } from '../theme';

function statusLabel(status: string) {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress') return 'Live';
  return 'Open';
}

function escapeCsv(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function hoursLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function clock(iso: string | null | undefined, timeZone?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone || undefined,
  });
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function TimesheetDateInput({
  value,
  max,
  onChange,
}: {
  value: string;
  max: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { theme } = useTheme();

  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker();
        return;
      }
    } catch {
      /* fall through — older browsers / blocked gesture */
    }
    el.focus();
    el.click();
  };

  return (
    <label className="timesheet-date-field">
      <span className="timesheet-date-label">Work date</span>
      <div className="timesheet-date-control">
        <input
          ref={ref}
          type="date"
          className="timesheet-date-input"
          value={value}
          max={max}
          min="2020-01-01"
          onChange={(e) => {
            const next = e.target.value;
            if (isIsoDate(next)) onChange(next);
          }}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPicker();
            }
          }}
          aria-label="Pick timesheet date"
          style={{ colorScheme: theme === 'dark' ? 'dark' : 'light' }}
        />
        <button
          type="button"
          className="timesheet-date-open"
          aria-label="Open calendar"
          tabIndex={-1}
          onClick={openPicker}
        >
          <span aria-hidden>▦</span>
        </button>
      </div>
    </label>
  );
}

export function TimesheetPage({
  user,
  timeZone,
}: {
  user: UserDto;
  timeZone?: string | null;
}) {
  const today = todayISO(timeZone);
  const [date, setDate] = useState(() => shiftDateISO(today, -1));
  const isToday = date === today;

  const tasksQ = useQuery({
    queryKey: ['tasks', date],
    queryFn: () => api.get<TaskDto[]>(`/api/tasks?date=${date}`),
  });
  const eodQ = useQuery({
    queryKey: ['eod', date],
    queryFn: () => api.get<EodSheetDto>(`/api/stats/eod?date=${date}`),
  });

  const tasks = useMemo(() => {
    const list = [...(tasksQ.data ?? [])];
    list.sort((a, b) => {
      if (a.scheduledStart && b.scheduledStart) {
        return a.scheduledStart.localeCompare(b.scheduledStart);
      }
      if (a.scheduledStart) return -1;
      if (b.scheduledStart) return 1;
      return a.order - b.order;
    });
    return list;
  }, [tasksQ.data]);

  const summary = eodQ.data?.summary;
  const totalActual = summary?.actualMinutes ?? 0;
  const totalEst = summary?.estimatedMinutes ?? 0;

  const dateLabel = useMemo(() => {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [date]);

  const sheetNo = useMemo(
    () => `TS-${date.replace(/-/g, '')}-${user.id.slice(-4).toUpperCase()}`,
    [date, user.id],
  );

  const onDownloadCsv = () => {
    const headers = [
      'Date',
      'Employee',
      'Task',
      'Start',
      'End',
      'Hours (actual)',
      'Hours (est)',
      'Status',
      'Comments',
    ];
    const rows = tasks.map((t) =>
      [
        t.date,
        user.name,
        t.name,
        clock(t.scheduledStart, timeZone),
        clock(t.scheduledEnd, timeZone),
        (t.actualMinutes / 60).toFixed(2),
        (t.estimatedMinutes / 60).toFixed(2),
        statusLabel(t.status),
        (t.notes ?? '').replace(/\n/g, ' | '),
      ]
        .map((c) => escapeCsv(String(c)))
        .join(','),
    );
    const totals = [
      '',
      '',
      'TOTAL HOURS',
      '',
      '',
      (totalActual / 60).toFixed(2),
      (totalEst / 60).toFixed(2),
      '',
      '',
    ]
      .map((c) => escapeCsv(c))
      .join(',');

    const csv = [
      'Cupkey timesheet',
      `Sheet No,${sheetNo}`,
      `Employee,${escapeCsv(user.name)}`,
      `Email,${escapeCsv(user.email)}`,
      `Work date,${date}`,
      `Generated,${new Date().toISOString()}`,
      '',
      headers.join(','),
      ...rows,
      totals,
    ].join('\n');

    downloadBlob(
      `timesheet-${date}.csv`,
      csv,
      'text/csv;charset=utf-8',
    );
  };

  return (
    <div className="timesheet-page">
      <div className="schedule-header no-print">
        <div>
          <h1 className="page-title">Timesheet</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Check previous days’ tasks and hours, then download a timesheet for
            your TL or personal records.
          </p>
        </div>
        <div className="date-nav">
          <button
            type="button"
            className="btn btn-ghost btn-sm date-nav-btn"
            aria-label="Previous day"
            onClick={() => setDate((d) => shiftDateISO(d, -1))}
          >
            ‹
          </button>
          <div className="date-nav-label">
            <strong>{dateLabel}</strong>
            {!isToday && <span className="date-nav-chip">Past day</span>}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm date-nav-btn"
            aria-label="Next day"
            onClick={() => setDate((d) => shiftDateISO(d, 1))}
          >
            ›
          </button>
          {!isToday && (
            <button
              type="button"
              className="btn btn-outline btn-pill btn-sm"
              onClick={() => setDate(today)}
            >
              Today
            </button>
          )}
        </div>
      </div>

      <div className="timesheet-toolbar no-print">
        <TimesheetDateInput
          value={date}
          max={today}
          onChange={setDate}
        />
        <div className="timesheet-toolbar-actions">
          <button
            type="button"
            className="btn btn-outline btn-pill"
            onClick={onDownloadCsv}
            disabled={!tasks.length}
          >
            Download CSV
          </button>
          <button
            type="button"
            className="btn btn-primary btn-pill"
            onClick={() => window.print()}
            disabled={!tasks.length}
          >
            Print / PDF
          </button>
        </div>
      </div>

      <article className="timesheet-sheet" id="timesheet-print">
        <header className="timesheet-head">
          <div>
            <p className="timesheet-brand">Cupkey</p>
            <h2>Daily timesheet</h2>
          </div>
          <div className="timesheet-head-meta">
            <div>
              <span>Sheet no.</span>
              <strong>{sheetNo}</strong>
            </div>
            <div>
              <span>Work date</span>
              <strong>{date}</strong>
            </div>
          </div>
        </header>

        <section className="timesheet-info">
          <div>
            <span>Employee</span>
            <strong>{user.name}</strong>
            <p>{user.email}</p>
          </div>
          <div>
            <span>Total hours (actual)</span>
            <strong>{hoursLabel(totalActual)}</strong>
            <p>
              Estimated {hoursLabel(totalEst)} ·{' '}
              {summary?.completed ?? 0}/{summary?.total ?? 0} tasks done
            </p>
          </div>
        </section>

        <div className="timesheet-table-wrap">
          <table className="timesheet-table">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Task / activity</th>
                <th>From</th>
                <th>To</th>
                <th>Hours</th>
                <th>Status</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => (
                <tr
                  key={t.id}
                  className={t.status === 'completed' ? 'is-done' : ''}
                >
                  <td className="mono">{i + 1}</td>
                  <td>
                    <strong>{t.name}</strong>
                    {t.scheduleLocked ? (
                      <MeetSourceBadge
                        sourceProvider={t.sourceProvider}
                        meetLink={t.meetLink}
                      />
                    ) : null}
                  </td>
                  <td className="mono">{clock(t.scheduledStart, timeZone)}</td>
                  <td className="mono">{clock(t.scheduledEnd, timeZone)}</td>
                  <td className="mono">
                    {(
                      (t.actualMinutes > 0
                        ? t.actualMinutes
                        : t.estimatedMinutes) / 60
                    ).toFixed(2)}
                    <span className="timesheet-hrs-hint">
                      {t.actualMinutes > 0 ? ' act' : ' est'}
                    </span>
                  </td>
                  <td>
                    <span className={`status-pill ${t.status}`}>
                      {statusLabel(t.status)}
                    </span>
                  </td>
                  <td className="timesheet-remarks">
                    {t.notes?.trim() || '—'}
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    {tasksQ.isLoading
                      ? 'Loading timesheet…'
                      : 'No tasks logged for this date.'}
                  </td>
                </tr>
              )}
            </tbody>
            {tasks.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4}>Total hours</td>
                  <td className="mono">{(totalActual / 60).toFixed(2)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="timesheet-footnote">
          Timesheet for {dateLabel}. Hours from Cupkey task timers and
          schedule. Share CSV or print for your team lead.
        </p>
      </article>
    </div>
  );
}
