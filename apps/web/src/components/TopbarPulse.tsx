'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { todayISO } from '../api';
import { useAppSelector } from '../store/hooks';

function formatClock(timeZone?: string | null) {
  const tz =
    timeZone?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());
  } catch {
    return new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}

/** Compact day pulse for the top bar — streak, util, badges, live clock. */
export function TopbarPulse({ timeZone }: { timeZone?: string | null }) {
  const date = todayISO(timeZone);
  const stats = useAppSelector((s) => s.stats.byDate[date]);
  const [clock, setClock] = useState(() => formatClock(timeZone));

  useEffect(() => {
    setClock(formatClock(timeZone));
    const id = window.setInterval(() => setClock(formatClock(timeZone)), 15_000);
    return () => window.clearInterval(id);
  }, [timeZone]);

  const util = stats?.utilization?.utilizationPercent ?? null;
  const streak = stats?.effort?.streakDays ?? null;
  const earned = stats?.effort?.earnedCount ?? null;
  const done = stats?.today?.completed ?? null;
  const total = stats?.today?.total ?? null;

  return (
    <div className="topbar-pulse" aria-label="Day pulse">
      <div className="topbar-pulse-clock" title="Local time">
        <span className="topbar-pulse-label">Now</span>
        <strong>{clock}</strong>
      </div>
      <span className="topbar-pulse-sep" aria-hidden />
      <div className="topbar-pulse-item" title="Day utilization">
        <span className="topbar-pulse-label">Load</span>
        <strong>{util == null ? '—' : `${util}%`}</strong>
      </div>
      <div className="topbar-pulse-item" title="Tasks done today">
        <span className="topbar-pulse-label">Done</span>
        <strong>
          {done == null || total == null ? '—' : `${done}/${total}`}
        </strong>
      </div>
      <div className="topbar-pulse-item" title="Completion streak">
        <span className="topbar-pulse-label">Streak</span>
        <strong>{streak == null ? '—' : `${streak}d`}</strong>
      </div>
      <Link
        href="/badges"
        className="topbar-pulse-badges"
        title="Open badges"
      >
        <span className="topbar-pulse-label">Badges</span>
        <strong>{earned == null ? '—' : earned}</strong>
      </Link>
    </div>
  );
}
