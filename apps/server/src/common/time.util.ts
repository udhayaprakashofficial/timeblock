/** Timezone-aware day/time helpers (IANA zones from geography, e.g. Asia/Kolkata). */

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function normalizeTimeZone(tz?: string | null): string {
  let raw = (tz ?? '').trim() || 'UTC';
  // Legacy IANA alias — prefer the canonical id
  if (raw === 'Asia/Calcutta') raw = 'Asia/Kolkata';
  try {
    // Throws RangeError for invalid IANA ids
    Intl.DateTimeFormat('en-US', { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return 'UTC';
  }
}

/**
 * Parse DB/API timestamps as UTC instants.
 * Supabase `timestamp without time zone` returns values like `2026-09-17T15:30:00`
 * (no Z). `new Date(...)` would treat those as *local*, shifting IST by 5.5h.
 */
export function parseUtcInstant(value: string | Date): Date {
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (!s) return new Date(NaN);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  return new Date(`${normalized}Z`);
}

/** Always emit ISO-8601 UTC with Z. */
export function toUtcIso(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  const d = parseUtcInstant(value as string | Date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Elapsed whole minutes between two DB timestamps (UTC-safe). */
export function elapsedMinutes(
  startedAt: string | Date,
  endedAt: string | Date = new Date(),
): number {
  const s = parseUtcInstant(startedAt);
  const e = parseUtcInstant(endedAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e.getTime() <= s.getTime()) {
    return 1;
  }
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 60000));
}

/**
 * Prefer duration from start/end timestamps when both exist (fixes bad stored
 * actualMinutes from naive Date parsing). Otherwise use stored actualMinutes.
 */
export function entryActualMinutes(entry: {
  actualMinutes?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
}): number {
  const started = entry.startedAt != null ? String(entry.startedAt) : '';
  const ended = entry.endedAt != null ? String(entry.endedAt) : '';
  if (started && ended) {
    return elapsedMinutes(started, ended);
  }
  const stored = Number(entry.actualMinutes);
  return Number.isFinite(stored) && stored > 0 ? Math.round(stored) : 0;
}

/** Civil YYYY-MM-DD for an instant in the given IANA timezone. */
export function formatDateInTimeZone(d: Date, timeZone?: string | null): string {
  const tz = normalizeTimeZone(timeZone);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Today's civil date in the given timezone. */
export function todayInTimeZone(timeZone?: string | null): string {
  return formatDateInTimeZone(new Date(), timeZone);
}

/**
 * Offset of `timeZone` at UTC instant `date` (ms to add to local wall to get UTC?);
 * returns (utcEpoch - wallAsUtcEpoch) equivalent: wallUTC - actualUTC... 
 * We use: format parts in TZ, interpret as UTC, difference = offset from UTC.
 */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

/** Convert civil date + minutes-from-midnight in `timeZone` → UTC Date. */
export function zonedTimeToUtc(
  dateStr: string,
  minutes: number,
  timeZone?: string | null,
): Date {
  const tz = normalizeTimeZone(timeZone);
  const [y, mo, d] = dateStr.split('-').map(Number);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  // First guess: treat wall clock as UTC, then subtract zone offset
  let guess = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
  let offset = getTimeZoneOffsetMs(guess, tz);
  guess = new Date(Date.UTC(y, mo - 1, d, h, m, 0) - offset);
  // DST edge: recompute once
  offset = getTimeZoneOffsetMs(guess, tz);
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0) - offset);
}

/** Start (inclusive) and end (exclusive) UTC instants for a civil day in `timeZone`. */
export function dayBoundsInTimeZone(
  dateStr: string,
  timeZone?: string | null,
): { start: Date; end: Date } {
  const start = zonedTimeToUtc(dateStr, 0, timeZone);
  const [y, mo, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  const end = zonedTimeToUtc(nextStr, 0, timeZone);
  return { start, end };
}

/** Weekday 0=Sun…6=Sat for a civil date in timezone (noon avoids DST edges). */
export function weekdayInTimeZone(
  dateStr: string,
  timeZone?: string | null,
): number {
  const noon = zonedTimeToUtc(dateStr, 12 * 60, timeZone);
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTimeZone(timeZone),
    weekday: 'short',
  }).format(noon);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? noon.getUTCDay();
}

/** Minutes from midnight in `timeZone` for an instant (on that civil day). */
export function minutesInTimeZone(
  instant: Date,
  timeZone?: string | null,
): number {
  const tz = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return Number(map.hour) * 60 + Number(map.minute);
}

/** Anchor Date for a civil YYYY-MM-DD (UTC midnight of that label — for Prisma @db.Date). */
export function dateOnly(d: Date | string): Date {
  if (typeof d === 'string') {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day));
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** @deprecated Prefer formatDateInTimeZone — kept for non-user-scoped code paths */
export function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function startOfWeek(d: Date): Date {
  const date = dateOnly(d);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

/** Monday-start week containing civil dateStr in timezone. */
export function startOfWeekInTimeZone(
  dateStr: string,
  timeZone?: string | null,
): string {
  const wd = weekdayInTimeZone(dateStr, timeZone);
  const diff = wd === 0 ? -6 : 1 - wd;
  return addDaysToDateStr(dateStr, diff);
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export interface Interval {
  start: number; // minutes from midnight in the user's timezone
  end: number;
}

export function subtractIntervals(
  available: Interval[],
  busy: Interval[],
): Interval[] {
  let result = [...available];
  for (const b of busy) {
    const next: Interval[] = [];
    for (const a of result) {
      if (b.end <= a.start || b.start >= a.end) {
        next.push(a);
        continue;
      }
      if (b.start > a.start) {
        next.push({ start: a.start, end: Math.min(b.start, a.end) });
      }
      if (b.end < a.end) {
        next.push({ start: Math.max(b.end, a.start), end: a.end });
      }
    }
    result = next.filter((i) => i.end > i.start);
  }
  return result;
}

/** Combine civil date + minutes in user timezone → UTC instant. */
export function combineDateAndMinutes(
  date: Date | string,
  minutes: number,
  timeZone?: string | null,
): Date {
  const dateStr =
    typeof date === 'string' ? date.slice(0, 10) : formatDateOnly(date);
  return zonedTimeToUtc(dateStr, minutes, timeZone);
}

/** Project an event onto a civil day in `timeZone` as minute intervals. */
export function eventToMinutesOnDay(
  day: Date | string,
  start: Date,
  end: Date,
  timeZone?: string | null,
): Interval | null {
  const dateStr =
    typeof day === 'string' ? day.slice(0, 10) : formatDateOnly(day);
  const { start: dayStart, end: dayEnd } = dayBoundsInTimeZone(
    dateStr,
    timeZone,
  );

  const s = Math.max(start.getTime(), dayStart.getTime());
  const e = Math.min(end.getTime(), dayEnd.getTime());
  if (e <= s) return null;

  const startMin = (s - dayStart.getTime()) / 60000;
  const endMin = (e - dayStart.getTime()) / 60000;
  return { start: startMin, end: endMin };
}
