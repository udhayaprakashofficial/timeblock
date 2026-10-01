import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import {
  combineDateAndMinutes,
  dateOnly,
  dayBoundsInTimeZone,
  eventToMinutesOnDay,
  formatDateInTimeZone,
  minutesInTimeZone,
  normalizeTimeZone,
  parseHm,
  rangesOverlap,
  subtractIntervals,
  type Interval,
} from '../common/time.util';

type PackableTask = {
  id: string;
  estimatedMinutes: number;
  status: string;
  scheduledStart?: string | Date | null;
  scheduledEnd?: string | Date | null;
  scheduleLocked?: boolean;
};

/** Drop / trim free slots that end at or before `notBefore` (minutes from midnight). */
function clipFreeAfter(
  intervals: Interval[],
  notBefore?: number | null,
): Interval[] {
  if (notBefore == null || !Number.isFinite(notBefore)) return intervals;
  const floor = Math.max(0, Math.ceil(notBefore));
  return intervals
    .map((i) => ({ start: Math.max(i.start, floor), end: i.end }))
    .filter((i) => i.end > i.start);
}

function carveFree(free: Interval[], placed: Interval): Interval[] {
  const next: Interval[] = [];
  for (const slot of free) {
    if (placed.end <= slot.start || placed.start >= slot.end) {
      next.push(slot);
      continue;
    }
    if (slot.start < placed.start) {
      next.push({ start: slot.start, end: placed.start });
    }
    if (placed.end < slot.end) {
      next.push({ start: placed.end, end: slot.end });
    }
  }
  return next.filter((s) => s.end > s.start);
}

/** True when [start, end) sits fully inside one free interval. */
function fitsInFree(free: Interval[], start: number, end: number): boolean {
  if (!(end > start)) return false;
  return free.some((slot) => start >= slot.start && end <= slot.end);
}

/**
 * Pure packer: place unlocked tasks into free slots without overlap.
 * - Locked Meet/calendar tasks stay fixed.
 * - Completed tasks keep their windows as busy.
 * - Unlocked tasks with a still-valid slot keep it (sticky) unless `repackUnlocked`.
 * - Everything else packs into the earliest slot that fits `estimatedMinutes`.
 */
export function packTasks(
  tasks: PackableTask[],
  intervals: Interval[],
  day: Date | string,
  timeZone?: string | null,
  /** When set (typically “now” for today), unlocked tasks pack only into slots at/after this minute. */
  notBeforeMinutes?: number | null,
  options?: { repackUnlocked?: boolean },
): Array<{ id: string; scheduledStart: Date | null; scheduledEnd: Date | null }> {
  const repackUnlocked = Boolean(options?.repackUnlocked);
  const locked = tasks.filter(
    (t) => t.scheduleLocked && t.status !== 'completed',
  );
  const pending = tasks.filter(
    (t) => t.status !== 'completed' && !t.scheduleLocked,
  );
  const completed = tasks.filter((t) => t.status === 'completed');

  const busyFixed: Interval[] = [];
  for (const t of [...completed, ...locked]) {
    if (t.scheduledStart && t.scheduledEnd) {
      const interval = eventToMinutesOnDay(
        day,
        new Date(t.scheduledStart),
        new Date(t.scheduledEnd),
        timeZone,
      );
      if (interval) busyFixed.push(interval);
    }
  }

  // Full-day free (work hours − breaks/meetings/locked). Sticky keeps existing
  // morning slots even when “now” has moved past them — otherwise onboarding
  // packs from 09:00 then the next reschedule throws everything after lunch.
  const dayFree = subtractIntervals(intervals, busyFixed);
  let free = clipFreeAfter(dayFree, notBeforeMinutes);
  const result: Array<{
    id: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
  }> = [];

  for (const task of locked) {
    result.push({
      id: task.id,
      scheduledStart: task.scheduledStart
        ? new Date(task.scheduledStart)
        : null,
      scheduledEnd: task.scheduledEnd ? new Date(task.scheduledEnd) : null,
    });
  }

  const needsPack: PackableTask[] = [];
  const placedUnlocked: Interval[] = [];

  for (const task of pending) {
    const need = Math.max(5, Math.round(Number(task.estimatedMinutes) || 30));
    if (
      !repackUnlocked &&
      task.scheduledStart &&
      task.scheduledEnd
    ) {
      const existing = eventToMinutesOnDay(
        day,
        new Date(task.scheduledStart),
        new Date(task.scheduledEnd),
        timeZone,
      );
      if (existing) {
        const start = existing.start;
        const end = start + need;
        const overlapsSibling = placedUnlocked.some((p) =>
          rangesOverlap(start, end, p.start, p.end),
        );
        // Validate against the full day, not the “now”-clipped free window.
        if (!overlapsSibling && fitsInFree(dayFree, start, end)) {
          const placed = { start, end };
          free = carveFree(free, placed);
          placedUnlocked.push(placed);
          result.push({
            id: task.id,
            scheduledStart: combineDateAndMinutes(day, placed.start, timeZone),
            scheduledEnd: combineDateAndMinutes(day, placed.end, timeZone),
          });
          continue;
        }
      }
    }
    needsPack.push(task);
  }

  for (const task of needsPack) {
    const need = Math.max(5, Math.round(Number(task.estimatedMinutes) || 30));
    let placed: Interval | null = null;
    for (let i = 0; i < free.length; i++) {
      const slot = free[i];
      if (slot.end - slot.start >= need) {
        placed = { start: slot.start, end: slot.start + need };
        free = carveFree(free, placed);
        break;
      }
    }

    // Today after hours: place near “now”, but only inside a free slot
    // (never over lunch/breaks or locked meetings).
    if (
      !placed &&
      notBeforeMinutes != null &&
      Number.isFinite(notBeforeMinutes)
    ) {
      const floor = Math.max(0, Math.ceil(notBeforeMinutes));
      for (let i = 0; i < free.length; i++) {
        const slot = free[i];
        const start = Math.max(slot.start, floor);
        if (slot.end - start < need) continue;
        placed = { start, end: start + need };
        free = carveFree(free, placed);
        break;
      }
    }

    if (placed) placedUnlocked.push(placed);

    result.push({
      id: task.id,
      scheduledStart: placed
        ? combineDateAndMinutes(day, placed.start, timeZone)
        : null,
      scheduledEnd: placed
        ? combineDateAndMinutes(day, placed.end, timeZone)
        : null,
    });
  }

  // Safety: if any unlocked results still overlap, force a full re-pack once.
  if (!repackUnlocked) {
    const unlockedPlaced = result.filter((r) => {
      const src = tasks.find((t) => t.id === r.id);
      return (
        src &&
        !src.scheduleLocked &&
        src.status !== 'completed' &&
        r.scheduledStart &&
        r.scheduledEnd
      );
    });
    let overlap = false;
    for (let i = 0; i < unlockedPlaced.length && !overlap; i++) {
      const a = eventToMinutesOnDay(
        day,
        unlockedPlaced[i].scheduledStart!,
        unlockedPlaced[i].scheduledEnd!,
        timeZone,
      );
      if (!a) continue;
      for (let j = i + 1; j < unlockedPlaced.length; j++) {
        const b = eventToMinutesOnDay(
          day,
          unlockedPlaced[j].scheduledStart!,
          unlockedPlaced[j].scheduledEnd!,
          timeZone,
        );
        if (b && rangesOverlap(a.start, a.end, b.start, b.end)) {
          overlap = true;
          break;
        }
      }
    }
    if (overlap) {
      return packTasks(tasks, intervals, day, timeZone, notBeforeMinutes, {
        repackUnlocked: true,
      });
    }
  }

  return result;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly supabase?: SupabaseRestService,
  ) {}

  private async resolveTimeZone(userId: string): Promise<string> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      if (user?.timezone) return normalizeTimeZone(user.timezone);
    } catch {
      /* REST fallback */
    }
    if (this.supabase?.isConfigured()) {
      const user = await this.supabase.getUserById(userId);
      if (user?.timezone) return normalizeTimeZone(user.timezone);
    }
    return 'UTC';
  }

  async getAvailableIntervals(
    userId: string,
    dateStr: string,
  ): Promise<{ intervals: Interval[]; availableMinutes: number }> {
    try {
      return await this.getAvailablePrisma(userId, dateStr);
    } catch (err) {
      if (this.supabase?.isConfigured()) {
        return this.getAvailableRest(userId, dateStr);
      }
      throw err;
    }
  }

  async rescheduleDay(
    userId: string,
    dateStr: string,
    options?: {
      repackUnlocked?: boolean;
      ignorePackingFloor?: boolean;
      allowOvertime?: boolean;
      overtimeMinutes?: number;
    },
  ) {
    try {
      await this.reschedulePrisma(userId, dateStr, options);
      return;
    } catch (err) {
      this.logger.warn(
        `Prisma reschedule failed, trying REST: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    if (this.supabase?.isConfigured()) {
      await this.rescheduleRest(userId, dateStr, options);
    }
  }

  /** Force REST packing (used after REST task create/reorder). */
  async rescheduleDayPreferRest(
    userId: string,
    dateStr: string,
    options?: {
      repackUnlocked?: boolean;
      ignorePackingFloor?: boolean;
      allowOvertime?: boolean;
      overtimeMinutes?: number;
    },
  ) {
    if (this.supabase?.isConfigured()) {
      try {
        await this.rescheduleRest(userId, dateStr, options);
        return;
      } catch (err) {
        this.logger.warn(
          `REST reschedule failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    await this.rescheduleDay(userId, dateStr, options);
  }

  private async getAvailablePrisma(userId: string, dateStr: string) {
    const day = dateOnly(dateStr);
    const weekday = day.getUTCDay();
    const timeZone = await this.resolveTimeZone(userId);

    const template = await this.prisma.dailyScheduleTemplate.findUnique({
      where: { userId_weekday: { userId, weekday } },
      include: { breaks: true },
    });

    if (!template) {
      return { intervals: [] as Interval[], availableMinutes: 0 };
    }

    let available: Interval[] = [
      {
        start: parseHm(template.workStart),
        end: parseHm(template.workEnd),
      },
    ];

    const breakBusy: Interval[] = template.breaks.map((b) => ({
      start: parseHm(b.start),
      end: parseHm(b.end),
    }));
    available = subtractIntervals(available, breakBusy);

    const { start: dayStart, end: dayEnd } = dayBoundsInTimeZone(
      dateStr,
      timeZone,
    );

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        userId,
        start: { lt: dayEnd },
        end: { gt: dayStart },
      },
    });

    const eventBusy: Interval[] = [];
    for (const ev of events) {
      const interval = eventToMinutesOnDay(day, ev.start, ev.end, timeZone);
      if (interval) eventBusy.push(interval);
    }
    available = subtractIntervals(available, eventBusy);

    const availableMinutes = available.reduce(
      (sum, i) => sum + (i.end - i.start),
      0,
    );
    return { intervals: available, availableMinutes };
  }

  private async getAvailableRest(userId: string, dateStr: string) {
    const day = dateOnly(dateStr);
    const weekday = day.getUTCDay();
    const timeZone = await this.resolveTimeZone(userId);
    const schedules = await this.supabase!.listSchedule(userId);
    const template = schedules.find((s) => s.weekday === weekday);
    if (!template) {
      return { intervals: [] as Interval[], availableMinutes: 0 };
    }

    let available: Interval[] = [
      {
        start: parseHm(template.workStart),
        end: parseHm(template.workEnd),
      },
    ];
    const breakBusy: Interval[] = template.breaks.map((b) => ({
      start: parseHm(b.start),
      end: parseHm(b.end),
    }));
    available = subtractIntervals(available, breakBusy);

    try {
      const events = await this.supabase!.listCalendarEvents(
        userId,
        dateStr,
        timeZone,
      );
      const eventBusy: Interval[] = [];
      for (const ev of events) {
        const interval = eventToMinutesOnDay(
          day,
          new Date(ev.start),
          new Date(ev.end),
          timeZone,
        );
        if (interval) eventBusy.push(interval);
      }
      available = subtractIntervals(available, eventBusy);
    } catch {
      /* calendar optional on REST */
    }

    const availableMinutes = available.reduce(
      (sum, i) => sum + (i.end - i.start),
      0,
    );
    return { intervals: available, availableMinutes };
  }

  /** For “today” in the user TZ, don’t pack unlocked tasks into the past. */
  private packingFloorMinutes(
    dateStr: string,
    timeZone: string,
  ): number | null {
    if (dateStr !== formatDateInTimeZone(new Date(), timeZone)) return null;
    return minutesInTimeZone(new Date(), timeZone);
  }

  /**
   * Append free time after the workday so a task can pack into overtime.
   * Only used when the user explicitly chose “Add to end of the day”.
   */
  private ensureOvertimePackWindow(
    intervals: Interval[],
    extraMinutes = 8 * 60,
  ): Interval[] {
    const coverageEnd = intervals.reduce((m, i) => Math.max(m, i.end), 0);
    const start = coverageEnd;
    const end = Math.min(24 * 60, start + Math.max(60, extraMinutes));
    if (end <= start) return intervals;
    return [...intervals, { start, end }];
  }

  /**
   * If “now” is past (or nearly past) the workday end, open an evening
   * window so new tasks still land on the plan.
   *
   * Extend only after the last free slot — never fill holes between
   * intervals (those holes are lunch/breaks/meetings already subtracted).
   */
  private ensureEveningPackWindow(
    intervals: Interval[],
    floor: number | null,
  ): Interval[] {
    if (floor == null || !Number.isFinite(floor)) return intervals;
    const coverageEnd = intervals.reduce((m, i) => Math.max(m, i.end), 0);
    // Need room for at least a typical 30–60m task after now
    if (coverageEnd > floor + 45) return intervals;
    const end = Math.min(24 * 60, Math.max(floor + 4 * 60, coverageEnd + 60));
    // Start at the later of “now” and the last free end so we do not
    // re-cover break gaps that were already subtracted from `intervals`.
    const start = Math.max(floor, coverageEnd);
    if (end <= start) return intervals;
    return [...intervals, { start, end }];
  }

  private async reschedulePrisma(
    userId: string,
    dateStr: string,
    options?: {
      repackUnlocked?: boolean;
      ignorePackingFloor?: boolean;
      allowOvertime?: boolean;
      overtimeMinutes?: number;
    },
  ) {
    const day = dateOnly(dateStr);
    const timeZone = await this.resolveTimeZone(userId);
    const floor = options?.ignorePackingFloor
      ? null
      : this.packingFloorMinutes(dateStr, timeZone);
    const available = await this.getAvailablePrisma(userId, dateStr);
    let intervals = options?.allowOvertime
      ? this.ensureOvertimePackWindow(
          available.intervals,
          options.overtimeMinutes,
        )
      : this.ensureEveningPackWindow(available.intervals, floor);
    const tasks = await this.prisma.task.findMany({
      where: { userId, date: day, inBacklog: false },
      orderBy: { order: 'asc' },
    });
    const packed = packTasks(
      tasks,
      intervals,
      dateStr,
      timeZone,
      options?.allowOvertime ? null : floor,
      options,
    );
    for (const p of packed) {
      const task = tasks.find((t) => t.id === p.id);
      const unplaced =
        task &&
        !task.scheduleLocked &&
        task.status !== 'completed' &&
        !p.scheduledStart;
      if (unplaced) {
        await this.prisma.task.update({
          where: { id: p.id },
          data: {
            inBacklog: true,
            scheduledStart: null,
            scheduledEnd: null,
            scheduleLocked: false,
          },
        });
        continue;
      }
      await this.prisma.task.update({
        where: { id: p.id },
        data: {
          scheduledStart: p.scheduledStart,
          scheduledEnd: p.scheduledEnd,
        },
      });
    }
  }

  private async rescheduleRest(
    userId: string,
    dateStr: string,
    options?: {
      repackUnlocked?: boolean;
      ignorePackingFloor?: boolean;
      allowOvertime?: boolean;
      overtimeMinutes?: number;
    },
  ) {
    const timeZone = await this.resolveTimeZone(userId);
    const floor = options?.ignorePackingFloor
      ? null
      : this.packingFloorMinutes(dateStr, timeZone);
    const available = await this.getAvailableRest(userId, dateStr);
    const intervals = options?.allowOvertime
      ? this.ensureOvertimePackWindow(
          available.intervals,
          options.overtimeMinutes,
        )
      : this.ensureEveningPackWindow(available.intervals, floor);
    const tasks = (await this.supabase!.listTasks(userId, dateStr)).filter(
      (t) => !t.inBacklog,
    );
    const packed = packTasks(
      tasks,
      intervals,
      dateStr,
      timeZone,
      options?.allowOvertime ? null : floor,
      options,
    );
    const now = new Date().toISOString();
    for (const p of packed) {
      const task = tasks.find((t) => t.id === p.id);
      const unplaced =
        task &&
        !task.scheduleLocked &&
        task.status !== 'completed' &&
        !p.scheduledStart;
      if (unplaced) {
        await this.supabase!.patch('Task', `id=eq.${p.id}`, {
          inBacklog: true,
          scheduledStart: null,
          scheduledEnd: null,
          scheduleLocked: false,
          updatedAt: now,
        });
        continue;
      }
      await this.supabase!.patch('Task', `id=eq.${p.id}`, {
        scheduledStart: p.scheduledStart?.toISOString() ?? null,
        scheduledEnd: p.scheduledEnd?.toISOString() ?? null,
        updatedAt: now,
      });
    }
  }
}
