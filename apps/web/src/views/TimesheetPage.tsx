'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { EodSheetDto, TaskDto, UserDto } from '@timeblock/shared-types';
import {
  api,
  detectBrowserTimeZone,
  parseInstant,
  shiftDateISO,
  todayISO,
} from '../api';
import { HintMark } from '../components/ui-hints';
import { TimesheetSheetView } from '../components/TimesheetSheetView';
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
      /* fall through */
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
  const [date, setDate] = useState(() => today);
  const isToday = date === today;
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!shareWrapRef.current?.contains(e.target as Node)) {
        setShareOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShareOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [shareOpen]);

  const tasksQ = useQuery({
    queryKey: ['tasks', date],
    queryFn: () => api.get<TaskDto[]>(`/api/tasks?date=${date}`),
  });
  const eodQ = useQuery({
    queryKey: ['eod', date],
    queryFn: () => api.get<EodSheetDto>(`/api/stats/eod?date=${date}`),
  });

  // Prefer EOD (includes backlog-dated history); fall back to live plan tasks
  const sheet: EodSheetDto | null = useMemo(() => {
    if (eodQ.data) return eodQ.data;
    const list = tasksQ.data ?? [];
    if (!list.length) return null;
    const rows = list.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      estimatedMinutes: t.estimatedMinutes,
      actualMinutes: t.actualMinutes,
      varianceMinutes: t.actualMinutes - t.estimatedMinutes,
      scheduledStart: t.scheduledStart,
      scheduledEnd: t.scheduledEnd,
      scheduleLocked: Boolean(t.scheduleLocked),
      meetLink: t.meetLink ?? null,
      notes: t.notes ?? null,
    }));
    const total = rows.length;
    const completed = rows.filter((t) => t.status === 'completed').length;
    return {
      date,
      generatedAt: new Date().toISOString(),
      summary: {
        total,
        completed,
        pending: total - completed,
        inProgress: rows.filter((t) => t.status === 'in_progress').length,
        estimatedMinutes: rows.reduce((s, t) => s + t.estimatedMinutes, 0),
        actualMinutes: rows.reduce((s, t) => s + t.actualMinutes, 0),
        completionPercent:
          total === 0 ? 0 : Math.round((completed / total) * 100),
      },
      tasks: rows,
      shipped: rows.filter((t) => t.status === 'completed').map((t) => t.name),
      remaining: rows
        .filter((t) => t.status !== 'completed')
        .map((t) => t.name),
    };
  }, [eodQ.data, tasksQ.data, date]);

  const tasks = sheet?.tasks ?? [];
  const totalActual = sheet?.summary.actualMinutes ?? 0;
  const totalEst = sheet?.summary.estimatedMinutes ?? 0;

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

  const shareMut = useMutation({
    mutationFn: async () => {
      const res = await api.post<{
        token: string;
        path: string;
        url?: string;
        expiresAt: string;
      }>('/api/stats/eod/share', { date });
      const origin =
        typeof window !== 'undefined' ? window.location.origin : '';
      return {
        url: `${origin}${res.path}`,
        expiresAt: res.expiresAt,
      };
    },
    onSuccess: (data) => {
      setShareUrl(data.url);
      setShareMsg(null);
    },
    onError: (err) => {
      setShareMsg(
        err instanceof Error ? err.message : 'Could not create share link',
      );
    },
  });

  const ensureShareUrl = async (): Promise<string | null> => {
    if (shareUrl) return shareUrl;
    try {
      const data = await shareMut.mutateAsync();
      return data.url;
    } catch {
      return null;
    }
  };

  const openShareMenu = () => {
    setShareOpen(true);
    setShareMsg(null);
    setCopied(false);
    if (!shareUrl && !shareMut.isPending) {
      void shareMut.mutate();
    }
  };

  const onCopyLink = async () => {
    const url = await ensureShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setShareMsg('Link copied');
    } catch {
      setShareMsg('Could not copy — select the link and copy manually');
    }
  };

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
        date,
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

    downloadBlob(`timesheet-${date}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <div className="timesheet-page">
      <div className="schedule-header no-print">
        <div>
          <h1 className="page-title">
            Timesheet <HintMark id="timesheet.hours" placement="bottom" />
          </h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Check previous days’ tasks and hours, then download or share a
            timesheet for your TL.
          </p>
        </div>
        <div className="date-nav">
          <button
            type="button"
            className="btn btn-ghost btn-sm date-nav-btn"
            aria-label="Previous day"
            onClick={() => {
              setShareUrl(null);
              setShareMsg(null);
              setShareOpen(false);
              setDate((d) => shiftDateISO(d, -1));
            }}
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
            disabled={date >= today}
            onClick={() => {
              setShareUrl(null);
              setShareMsg(null);
              setShareOpen(false);
              setDate((d) => {
                const next = shiftDateISO(d, 1);
                return next > today ? today : next;
              });
            }}
          >
            ›
          </button>
          {!isToday && (
            <button
              type="button"
              className="btn btn-outline btn-pill btn-sm"
              onClick={() => {
                setShareUrl(null);
                setShareMsg(null);
                setShareOpen(false);
                setDate(today);
              }}
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
          onChange={(next) => {
            setShareUrl(null);
            setShareMsg(null);
            setShareOpen(false);
            setDate(next);
          }}
        />
        <div className="timesheet-toolbar-actions">
          <div className="timesheet-share-wrap" ref={shareWrapRef}>
            <button
              type="button"
              className={`btn btn-outline btn-pill${shareOpen ? ' is-open' : ''}`}
              onClick={() => {
                if (shareOpen) setShareOpen(false);
                else openShareMenu();
              }}
              disabled={!tasks.length || shareMut.isPending}
              aria-expanded={shareOpen}
              aria-haspopup="dialog"
            >
              {shareMut.isPending && !shareUrl ? 'Preparing…' : 'Share link'}
            </button>
            {shareOpen && (
              <div className="timesheet-share-dropdown" role="dialog" aria-label="Share timesheet">
                <p className="timesheet-share-drop-title">Share timesheet</p>
                <p className="timesheet-share-drop-sub">
                  {dateLabel} · view-only · 30 days
                </p>

                <label className="timesheet-share-email-label" htmlFor="ts-share-link">
                  Link
                </label>
                <div className="timesheet-share-row">
                  <input
                    id="ts-share-link"
                    className="timesheet-share-input"
                    readOnly
                    value={shareUrl || (shareMut.isPending ? 'Creating link…' : '')}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Shareable timesheet link"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void onCopyLink()}
                    disabled={!shareUrl && shareMut.isPending}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <label className="timesheet-share-email-label" htmlFor="ts-share-to">
                  Email from your Gmail
                </label>
                <input
                  id="ts-share-to"
                  type="email"
                  className="timesheet-share-input timesheet-share-input-full"
                  placeholder="tl@company.com"
                  value=""
                  disabled
                  readOnly
                  aria-disabled="true"
                />
                <div className="timesheet-share-gmail-soon">
                  <button
                    type="button"
                    className="btn btn-primary btn-pill timesheet-share-send"
                    disabled
                    aria-label="Send from Gmail — coming soon"
                  >
                    Send from Gmail
                  </button>
                  <span className="coming-soon-tag" aria-hidden>
                    Coming soon
                  </span>
                </div>
                {shareMsg && (
                  <p
                    className={`timesheet-share-status${
                      /sent|copied/i.test(shareMsg) ? ' is-ok' : ' is-err'
                    }`}
                    role="status"
                  >
                    {shareMsg}
                  </p>
                )}
              </div>
            )}
          </div>
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

      {eodQ.isLoading && tasksQ.isLoading ? (
        <p className="composer-hint">Loading timesheet…</p>
      ) : sheet ? (
        <TimesheetSheetView
          employeeName={user.name}
          employeeEmail={user.email}
          sheetNo={sheetNo}
          date={date}
          sheet={sheet}
          timeZone={timeZone}
          footnoteExtra="Share a link, CSV, or print for your team lead."
        />
      ) : (
        <p className="composer-hint">No tasks for this date.</p>
      )}
    </div>
  );
}
