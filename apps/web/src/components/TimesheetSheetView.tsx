'use client';

import { useMemo } from 'react';
import type { EodSheetDto, EodTaskRowDto } from '@timeblock/shared-types';
import {
  detectBrowserTimeZone,
  parseInstant,
} from '../api';
import { MeetSourceBadge } from './MeetSourceBadge';

function statusLabel(status: string) {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress') return 'Live';
  return 'Open';
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
  const d = parseInstant(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const tz = timeZone?.trim() || detectBrowserTimeZone();
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

export type TimesheetSheetProps = {
  employeeName: string;
  employeeEmail: string;
  sheetNo: string;
  date: string;
  sheet: EodSheetDto;
  timeZone?: string | null;
  footnoteExtra?: string;
};

export function TimesheetSheetView({
  employeeName,
  employeeEmail,
  sheetNo,
  date,
  sheet,
  timeZone,
  footnoteExtra,
}: TimesheetSheetProps) {
  const summary = sheet.summary;
  const totalActual = summary?.actualMinutes ?? 0;
  const totalEst = summary?.estimatedMinutes ?? 0;
  const tasks = useMemo(() => {
    const list = [...(sheet.tasks ?? [])] as EodTaskRowDto[];
    list.sort((a, b) => {
      if (a.scheduledStart && b.scheduledStart) {
        return a.scheduledStart.localeCompare(b.scheduledStart);
      }
      if (a.scheduledStart) return -1;
      if (b.scheduledStart) return 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [sheet.tasks]);

  const dateLabel = useMemo(() => {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [date]);

  return (
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
          <strong>{employeeName}</strong>
          <p>{employeeEmail || '—'}</p>
        </div>
        <div>
          <span>Total hours (actual)</span>
          <strong>{hoursLabel(totalActual)}</strong>
          <p>
            Estimated {hoursLabel(totalEst)} · {summary?.completed ?? 0}/
            {summary?.total ?? 0} tasks done
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
                    <MeetSourceBadge meetLink={t.meetLink} />
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
                <td className="timesheet-remarks">{t.notes?.trim() || '—'}</td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={7}>No tasks for this date.</td>
              </tr>
            )}
          </tbody>
          {tasks.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>Total hours (actual)</td>
                <td className="mono">{(totalActual / 60).toFixed(2)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="timesheet-footnote">
        Timesheet for {dateLabel}. Hours from Cupkey task timers and schedule.
        {footnoteExtra ? ` ${footnoteExtra}` : ''}
      </p>
    </article>
  );
}
