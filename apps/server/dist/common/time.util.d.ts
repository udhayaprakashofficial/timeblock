/** Timezone-aware day/time helpers (IANA zones from geography, e.g. Asia/Kolkata). */
export declare function parseHm(hm: string): number;
export declare function minutesToHm(total: number): string;
export declare function normalizeTimeZone(tz?: string | null): string;
/**
 * Parse DB/API timestamps as UTC instants.
 * Supabase `timestamp without time zone` returns values like `2026-09-17T15:30:00`
 * (no Z). `new Date(...)` would treat those as *local*, shifting IST by 5.5h.
 */
export declare function parseUtcInstant(value: string | Date): Date;
/** Always emit ISO-8601 UTC with Z. */
export declare function toUtcIso(value: string | Date | null | undefined): string | null;
/** Civil YYYY-MM-DD for an instant in the given IANA timezone. */
export declare function formatDateInTimeZone(d: Date, timeZone?: string | null): string;
/** Today's civil date in the given timezone. */
export declare function todayInTimeZone(timeZone?: string | null): string;
/** Convert civil date + minutes-from-midnight in `timeZone` → UTC Date. */
export declare function zonedTimeToUtc(dateStr: string, minutes: number, timeZone?: string | null): Date;
/** Start (inclusive) and end (exclusive) UTC instants for a civil day in `timeZone`. */
export declare function dayBoundsInTimeZone(dateStr: string, timeZone?: string | null): {
    start: Date;
    end: Date;
};
/** Weekday 0=Sun…6=Sat for a civil date in timezone (noon avoids DST edges). */
export declare function weekdayInTimeZone(dateStr: string, timeZone?: string | null): number;
/** Minutes from midnight in `timeZone` for an instant (on that civil day). */
export declare function minutesInTimeZone(instant: Date, timeZone?: string | null): number;
/** Anchor Date for a civil YYYY-MM-DD (UTC midnight of that label — for Prisma @db.Date). */
export declare function dateOnly(d: Date | string): Date;
/** @deprecated Prefer formatDateInTimeZone — kept for non-user-scoped code paths */
export declare function formatDateOnly(d: Date): string;
export declare function startOfWeek(d: Date): Date;
/** Monday-start week containing civil dateStr in timezone. */
export declare function startOfWeekInTimeZone(dateStr: string, timeZone?: string | null): string;
export declare function addDaysToDateStr(dateStr: string, days: number): string;
export declare function addDays(d: Date, days: number): Date;
export interface Interval {
    start: number;
    end: number;
}
export declare function subtractIntervals(available: Interval[], busy: Interval[]): Interval[];
/** Combine civil date + minutes in user timezone → UTC instant. */
export declare function combineDateAndMinutes(date: Date | string, minutes: number, timeZone?: string | null): Date;
/** Project an event onto a civil day in `timeZone` as minute intervals. */
export declare function eventToMinutesOnDay(day: Date | string, start: Date, end: Date, timeZone?: string | null): Interval | null;
