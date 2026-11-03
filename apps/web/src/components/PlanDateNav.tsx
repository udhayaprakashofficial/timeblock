'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { shiftDateISO, todayISO } from '../api';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [ys, ms, ds] = ymd.slice(0, 10).split('-');
  return { y: Number(ys), m: Number(ms), d: Number(ds) };
}

function toYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function weekdaySun0(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function monthLabel(y: number, m: number): string {
  return new Date(Date.UTC(y, m - 1, 12)).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatPlanDate(ymd: string, timeZone?: string | null): string {
  try {
    return new Date(`${ymd.slice(0, 10)}T12:00:00`).toLocaleDateString(
      undefined,
      {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: timeZone || undefined,
      },
    );
  } catch {
    return ymd;
  }
}

type Cell = {
  ymd: string;
  day: number;
  inMonth: boolean;
};

function buildMonthCells(y: number, m: number): Cell[] {
  const firstDow = weekdaySun0(y, m, 1);
  const dim = daysInMonth(y, m);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const prevDim = daysInMonth(prevY, prevM);
  const cells: Cell[] = [];

  for (let i = 0; i < firstDow; i++) {
    const d = prevDim - firstDow + 1 + i;
    cells.push({ ymd: toYmd(prevY, prevM, d), day: d, inMonth: false });
  }
  for (let d = 1; d <= dim; d++) {
    cells.push({ ymd: toYmd(y, m, d), day: d, inMonth: true });
  }
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  let n = 1;
  while (cells.length % 7 !== 0 || cells.length < 42) {
    cells.push({ ymd: toYmd(nextY, nextM, n), day: n, inMonth: false });
    n += 1;
    if (cells.length >= 42) break;
  }
  return cells;
}

function Chevron({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={dir === 'prev' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Plan header date control.
 * Layout matches the column head: title + muted date on the left,
 * compact ‹ › on the right. Click the date to open the month calendar.
 */
export function PlanDateNav({
  date,
  timeZone,
  onChange,
  title,
}: {
  date: string;
  timeZone?: string | null;
  onChange: (next: string) => void;
  title?: ReactNode;
}) {
  const today = todayISO(timeZone);
  const isToday = date === today;
  const label = useMemo(
    () => formatPlanDate(date, timeZone),
    [date, timeZone],
  );
  const [open, setOpen] = useState(false);
  const selected = parseYmd(date);
  const [viewY, setViewY] = useState(selected.y);
  const [viewM, setViewM] = useState(selected.m);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const { y, m } = parseYmd(date);
    setViewY(y);
    setViewM(m);
  }, [open, date]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cells = useMemo(() => buildMonthCells(viewY, viewM), [viewY, viewM]);

  const goMonth = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewY(y);
    setViewM(m);
  };

  const pick = (ymd: string) => {
    onChange(ymd);
    setOpen(false);
  };

  const onDateKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(shiftDateISO(date, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(shiftDateISO(date, 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((v) => !v);
    }
  };

  return (
    <div className="plan-date-nav" ref={rootRef}>
      <div className="plan-date-nav-main">
        <div className="plan-date-nav-copy">
          {title ? <h2 className="dash-col-title">{title}</h2> : null}
          <button
            type="button"
            className={`plan-date-link${open ? ' is-open' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={panelId}
            title="Open calendar"
            onClick={() => setOpen((v) => !v)}
            onKeyDown={onDateKey}
          >
            <span>{label}</span>
            <svg
              className="plan-date-link-caret"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="plan-date-nav-controls" role="group" aria-label="Change day">
          <button
            type="button"
            className="plan-date-step"
            aria-label="Previous day"
            onClick={() => onChange(shiftDateISO(date, -1))}
          >
            <Chevron dir="prev" />
          </button>
          <button
            type="button"
            className="plan-date-step"
            aria-label="Next day"
            onClick={() => onChange(shiftDateISO(date, 1))}
          >
            <Chevron dir="next" />
          </button>
          {!isToday ? (
            <button
              type="button"
              className="plan-date-today"
              onClick={() => onChange(today)}
            >
              Today
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div
          id={panelId}
          className="plan-date-cal"
          role="dialog"
          aria-label="Choose a date"
        >
          <div className="plan-date-cal-head">
            <button
              type="button"
              className="plan-date-step"
              aria-label="Previous month"
              onClick={() => goMonth(-1)}
            >
              <Chevron dir="prev" />
            </button>
            <strong>{monthLabel(viewY, viewM)}</strong>
            <button
              type="button"
              className="plan-date-step"
              aria-label="Next month"
              onClick={() => goMonth(1)}
            >
              <Chevron dir="next" />
            </button>
          </div>
          <div className="mini-cal-grid plan-date-cal-grid">
            {DOW.map((d) => (
              <span key={d} className="dow">
                {d}
              </span>
            ))}
            {cells.map((c) => {
              const isSelected = c.ymd === date;
              const isTodayCell = c.ymd === today;
              return (
                <button
                  key={`${c.ymd}-${c.inMonth ? 'in' : 'out'}`}
                  type="button"
                  className={[
                    'day',
                    c.inMonth ? '' : 'muted',
                    isTodayCell ? 'today' : '',
                    isSelected ? 'selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={c.ymd}
                  aria-current={isSelected ? 'date' : undefined}
                  onClick={() => pick(c.ymd)}
                >
                  {c.day}
                </button>
              );
            })}
          </div>
          {!isToday ? (
            <div className="plan-date-cal-foot">
              <button
                type="button"
                className="plan-date-today"
                onClick={() => pick(today)}
              >
                Jump to today
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
