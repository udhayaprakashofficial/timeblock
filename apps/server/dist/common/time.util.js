"use strict";
/** Timezone-aware day/time helpers (IANA zones from geography, e.g. Asia/Kolkata). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHm = parseHm;
exports.minutesToHm = minutesToHm;
exports.normalizeTimeZone = normalizeTimeZone;
exports.parseUtcInstant = parseUtcInstant;
exports.toUtcIso = toUtcIso;
exports.formatDateInTimeZone = formatDateInTimeZone;
exports.todayInTimeZone = todayInTimeZone;
exports.zonedTimeToUtc = zonedTimeToUtc;
exports.dayBoundsInTimeZone = dayBoundsInTimeZone;
exports.weekdayInTimeZone = weekdayInTimeZone;
exports.minutesInTimeZone = minutesInTimeZone;
exports.dateOnly = dateOnly;
exports.formatDateOnly = formatDateOnly;
exports.startOfWeek = startOfWeek;
exports.startOfWeekInTimeZone = startOfWeekInTimeZone;
exports.addDaysToDateStr = addDaysToDateStr;
exports.addDays = addDays;
exports.subtractIntervals = subtractIntervals;
exports.combineDateAndMinutes = combineDateAndMinutes;
exports.eventToMinutesOnDay = eventToMinutesOnDay;
function parseHm(hm) {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
}
function minutesToHm(total) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function normalizeTimeZone(tz) {
    let raw = (tz ?? '').trim() || 'UTC';
    // Legacy IANA alias — prefer the canonical id
    if (raw === 'Asia/Calcutta')
        raw = 'Asia/Kolkata';
    try {
        // Throws RangeError for invalid IANA ids
        Intl.DateTimeFormat('en-US', { timeZone: raw }).format(new Date());
        return raw;
    }
    catch {
        return 'UTC';
    }
}
/**
 * Parse DB/API timestamps as UTC instants.
 * Supabase `timestamp without time zone` returns values like `2026-09-17T15:30:00`
 * (no Z). `new Date(...)` would treat those as *local*, shifting IST by 5.5h.
 */
function parseUtcInstant(value) {
    if (value instanceof Date)
        return value;
    const s = String(value).trim();
    if (!s)
        return new Date(NaN);
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s))
        return new Date(s);
    const normalized = s.includes('T') ? s : s.replace(' ', 'T');
    return new Date(`${normalized}Z`);
}
/** Always emit ISO-8601 UTC with Z. */
function toUtcIso(value) {
    if (value == null || value === '')
        return null;
    const d = parseUtcInstant(value);
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toISOString();
}
/** Civil YYYY-MM-DD for an instant in the given IANA timezone. */
function formatDateInTimeZone(d, timeZone) {
    const tz = normalizeTimeZone(timeZone);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
/** Today's civil date in the given timezone. */
function todayInTimeZone(timeZone) {
    return formatDateInTimeZone(new Date(), timeZone);
}
/**
 * Offset of `timeZone` at UTC instant `date` (ms to add to local wall to get UTC?);
 * returns (utcEpoch - wallAsUtcEpoch) equivalent: wallUTC - actualUTC...
 * We use: format parts in TZ, interpret as UTC, difference = offset from UTC.
 */
function getTimeZoneOffsetMs(date, timeZone) {
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
    const map = {};
    for (const p of parts) {
        if (p.type !== 'literal')
            map[p.type] = p.value;
    }
    const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    return asUtc - date.getTime();
}
/** Convert civil date + minutes-from-midnight in `timeZone` → UTC Date. */
function zonedTimeToUtc(dateStr, minutes, timeZone) {
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
function dayBoundsInTimeZone(dateStr, timeZone) {
    const start = zonedTimeToUtc(dateStr, 0, timeZone);
    const [y, mo, d] = dateStr.split('-').map(Number);
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    const end = zonedTimeToUtc(nextStr, 0, timeZone);
    return { start, end };
}
/** Weekday 0=Sun…6=Sat for a civil date in timezone (noon avoids DST edges). */
function weekdayInTimeZone(dateStr, timeZone) {
    const noon = zonedTimeToUtc(dateStr, 12 * 60, timeZone);
    const wd = new Intl.DateTimeFormat('en-US', {
        timeZone: normalizeTimeZone(timeZone),
        weekday: 'short',
    }).format(noon);
    const map = {
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
function minutesInTimeZone(instant, timeZone) {
    const tz = normalizeTimeZone(timeZone);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(instant);
    const map = {};
    for (const p of parts) {
        if (p.type !== 'literal')
            map[p.type] = p.value;
    }
    return Number(map.hour) * 60 + Number(map.minute);
}
/** Anchor Date for a civil YYYY-MM-DD (UTC midnight of that label — for Prisma @db.Date). */
function dateOnly(d) {
    if (typeof d === 'string') {
        const [y, m, day] = d.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, day));
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
/** @deprecated Prefer formatDateInTimeZone — kept for non-user-scoped code paths */
function formatDateOnly(d) {
    return d.toISOString().slice(0, 10);
}
function startOfWeek(d) {
    const date = dateOnly(d);
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    return date;
}
/** Monday-start week containing civil dateStr in timezone. */
function startOfWeekInTimeZone(dateStr, timeZone) {
    const wd = weekdayInTimeZone(dateStr, timeZone);
    const diff = wd === 0 ? -6 : 1 - wd;
    return addDaysToDateStr(dateStr, diff);
}
function addDaysToDateStr(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + days));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
function addDays(d, days) {
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}
function subtractIntervals(available, busy) {
    let result = [...available];
    for (const b of busy) {
        const next = [];
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
function combineDateAndMinutes(date, minutes, timeZone) {
    const dateStr = typeof date === 'string' ? date.slice(0, 10) : formatDateOnly(date);
    return zonedTimeToUtc(dateStr, minutes, timeZone);
}
/** Project an event onto a civil day in `timeZone` as minute intervals. */
function eventToMinutesOnDay(day, start, end, timeZone) {
    const dateStr = typeof day === 'string' ? day.slice(0, 10) : formatDateOnly(day);
    const { start: dayStart, end: dayEnd } = dayBoundsInTimeZone(dateStr, timeZone);
    const s = Math.max(start.getTime(), dayStart.getTime());
    const e = Math.min(end.getTime(), dayEnd.getTime());
    if (e <= s)
        return null;
    const startMin = (s - dayStart.getTime()) / 60000;
    const endMin = (e - dayStart.getTime()) / 60000;
    return { start: startMin, end: endMin };
}
//# sourceMappingURL=time.util.js.map