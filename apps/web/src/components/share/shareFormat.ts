/** Cupkey share / report formatting helpers */

export function formatHm(mins: number): string {
  const n = Math.max(0, Math.round(mins));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatDrift(mins: number): string {
  if (mins === 0) return '0m';
  const sign = mins > 0 ? '+' : '−';
  return `${sign}${formatHm(Math.abs(mins))}`;
}

/** ISO week number (UTC noon anchor). */
export function isoWeekNumber(isoDate: string): number {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatWeekSpan(start: string, end: string): string {
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  };
  return `${a.toLocaleDateString('en-GB', opts)} – ${b.toLocaleDateString('en-GB', opts)}`;
}

export function weekdayShort(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  }).toUpperCase();
}

export type ShareWeekPayload = {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  estimatedMinutes: number;
  actualMinutes: number;
  driftMinutes: number;
  completed: number;
  total: number;
  completionPercent: number;
  accuracyPercent: number;
  days: Array<{
    date: string;
    label: string;
    estimatedMinutes: number;
    actualMinutes: number;
  }>;
  streakDays?: number;
  peakHour?: string;
  handle?: string;
};

export type ShareBadgePayload = {
  title: string;
  body: string;
  days?: string[];
};
