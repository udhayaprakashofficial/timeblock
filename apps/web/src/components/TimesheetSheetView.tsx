'use client';

import { useMemo } from 'react';
import type { EodSheetDto, EodTaskRowDto } from '@timeblock/shared-types';
import {
  detectBrowserTimeZone,
  parseInstant,
} from '../api';
import { MeetSourceBadge } from './MeetSourceBadge';
import { formatMinutesLabel } from './share/shareFormat';

function statusLabel(status: string) {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress') return 'Live';
  return 'Open';
}

function hoursLabel(minutes: number) {
  return formatMinutesLabel(minutes);
}

function hoursDecimal(minutes: number) {
  return (Math.max(0, Math.round(minutes)) / 60).toFixed(2);
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

/** Logged time for the sheet — never fall back to estimate in the Actual column. */
function actualUsedMinutes(t: EodTaskRowDto): number {
  return Math.max(0, Number(t.actualMinutes) || 0);
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
          <span>Hours used (actual)</span>
          <strong>{hoursLabel(totalActual)}</strong>
          <p>
            Planned {hoursLabel(totalEst)} · {summary?.completed ?? 0}/
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
              <th>Est. hours</th>
              <th>Actual hours</th>
              <th>Status</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => {
              const actual = actualUsedMinutes(t);
              const variance = actual - (t.estimatedMinutes || 0);
              return (
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
                  <td className="mono timesheet-hrs-est">
                    {hoursDecimal(t.estimatedMinutes || 0)}
                  </td>
                  <td className="mono timesheet-hrs-act">
                    {actual > 0 ? (
                      <>
                        {hoursDecimal(actual)}
                        {t.status === 'completed' &&
                        Math.abs(variance) >= 1 ? (
                          <span
                            className={`timesheet-hrs-hint${
                              variance > 0 ? ' is-over' : ' is-under'
                            }`}
                          >
                            {variance > 0
                              ? ` +${hoursDecimal(variance)}`
                              : ` ${hoursDecimal(variance)}`}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="timesheet-hrs-empty">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`status-pill ${t.status}`}>
                      {statusLabel(t.status)}
                    </span>
                  </td>
                  <td className="timesheet-remarks">{t.notes?.trim() || '—'}</td>
                </tr>
              );
            })}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={8}>No tasks for this date.</td>
              </tr>
            )}
          </tbody>
          {tasks.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>Totals</td>
                <td className="mono">{hoursDecimal(totalEst)}</td>
                <td className="mono timesheet-hrs-act">
                  {hoursDecimal(totalActual)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="timesheet-footnote">
        Timesheet for {dateLabel}. Actual hours come from Start / Pause / Done
        sessions — planned estimates stay in Est. hours.
        {footnoteExtra ? ` ${footnoteExtra}` : ''}
      </p>
    </article>
  );
}
