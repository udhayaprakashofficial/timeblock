import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import {
  combineDateAndMinutes,
  dateOnly,
  dayBoundsInTimeZone,
  eventToMinutesOnDay,
  normalizeTimeZone,
  parseHm,
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

/** Pure packer: place unlocked tasks into contiguous free slots; keep locked Meet/calendar tasks fixed. */
export function packTasks(
  tasks: PackableTask[],
  intervals: Interval[],
  day: Date | string,
  timeZone?: string | null,
): Array<{ id: string; scheduledStart: Date | null; scheduledEnd: Date | null }> {
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

  let free = subtractIntervals(intervals, busyFixed);
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

  for (const task of pending) {
    const need = Math.max(5, task.estimatedMinutes);
    let placed: Interval | null = null;
    for (let i = 0; i < free.length; i++) {
      const slot = free[i];
      if (slot.end - slot.start >= need) {
        placed = { start: slot.start, end: slot.start + need };
        free = [
          ...free.slice(0, i),
          ...(slot.start + need < slot.end
            ? [{ start: slot.start + need, end: slot.end }]
            : []),
          ...free.slice(i + 1),
        ];
        break;
      }
    }

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

  async rescheduleDay(userId: string, dateStr: string) {
    try {
      await this.reschedulePrisma(userId, dateStr);
      return;
    } catch (err) {
      this.logger.warn(
        `Prisma reschedule failed, trying REST: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    if (this.supabase?.isConfigured()) {
      await this.rescheduleRest(userId, dateStr);
    }
  }

  /** Force REST packing (used after REST task create/reorder). */
  async rescheduleDayPreferRest(userId: string, dateStr: string) {
    if (this.supabase?.isConfigured()) {
      try {
        await this.rescheduleRest(userId, dateStr);
        return;
      } catch (err) {
        this.logger.warn(
          `REST reschedule failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    await this.rescheduleDay(userId, dateStr);
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

  private async reschedulePrisma(userId: string, dateStr: string) {
    const day = dateOnly(dateStr);
    const timeZone = await this.resolveTimeZone(userId);
    const { intervals } = await this.getAvailablePrisma(userId, dateStr);
    const tasks = await this.prisma.task.findMany({
      where: { userId, date: day, inBacklog: false },
      orderBy: { order: 'asc' },
    });
    const packed = packTasks(tasks, intervals, dateStr, timeZone);
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

  private async rescheduleRest(userId: string, dateStr: string) {
    const timeZone = await this.resolveTimeZone(userId);
    const { intervals } = await this.getAvailableRest(userId, dateStr);
    const tasks = (await this.supabase!.listTasks(userId, dateStr)).filter(
      (t) => !t.inBacklog,
    );
    const packed = packTasks(tasks, intervals, dateStr, timeZone);
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
