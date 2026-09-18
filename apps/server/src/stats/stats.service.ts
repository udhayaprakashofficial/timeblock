import { Injectable } from '@nestjs/common';
import type {
  DayUtilizationDto,
  EodSheetDto,
  StatsOverviewDto,
  TaskStatus,
  WeeklyReportDto,
  WeeklyReportDayDto,
  WeeklyReportTaskDto,
} from '@timeblock/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../tasks/scheduler.service';
import { LocalDataStore } from '../auth/local-data.store';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
import {
  addDays,
  dateOnly,
  formatDateOnly,
  startOfWeek,
} from '../common/time.util';
import { buildEffortSummary } from './effort-badges';

type TaskLike = {
  id: string;
  name: string;
  date: string;
  estimatedMinutes: number;
  actualMinutes: number;
  status: string;
  scheduleLocked?: boolean;
  scheduledStart?: string | Date | null;
  scheduledEnd?: string | Date | null;
  meetLink?: string | null;
  notes?: string | null;
};

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly local: LocalDataStore,
    private readonly supabase: SupabaseRestService,
    private readonly db: DbBridgeService,
  ) {}

  async overview(userId: string, dateStr: string): Promise<StatsOverviewDto> {
    if (this.db.useDb()) {
      try {
        const id = await this.db.resolveUserId(userId);
        const day = dateOnly(dateStr);
        const weekStart = startOfWeek(day);
        const weekEnd = addDays(weekStart, 6);
        const todayTasks = await this.supabase.listTasks(id, dateStr);
        const weekTasks = await this.supabase.listTasksInRange(
          id,
          formatDateOnly(weekStart),
          formatDateOnly(weekEnd),
        );
        const recentStart = formatDateOnly(addDays(day, -13));
        const recentEnd = formatDateOnly(weekEnd);
        const recentTasks = await this.supabase.listTasksInRange(
          id,
          recentStart,
          recentEnd,
        );
        const utilization = await this.utilizationFromTasks(
          id,
          dateStr,
          todayTasks,
        );
        return {
          today: this.counters(todayTasks),
          week: this.counters(weekTasks),
          utilization,
          effort: buildEffortSummary({
            date: dateStr,
            todayTasks: this.asEffortTasks(todayTasks),
            weekTasks: this.asEffortTasks(weekTasks),
            recentTasks: this.asEffortTasks(recentTasks),
            utilizationPercent: utilization.utilizationPercent,
          }),
        };
      } catch (err) {
        console.warn(
          '[stats] DB overview failed',
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (userId.startsWith('local_')) {
      return this.local.overview(userId, dateStr);
    }
    try {
      const day = dateOnly(dateStr);
      const weekStart = startOfWeek(day);
      const weekEnd = addDays(weekStart, 6);

      const todayTasks = await this.prisma.task.findMany({
        where: { userId, date: day },
      });
      const weekTasks = await this.prisma.task.findMany({
        where: {
          userId,
          date: { gte: weekStart, lte: weekEnd },
        },
      });

      const recentStart = addDays(day, -13);
      const recentTasks = await this.prisma.task.findMany({
        where: {
          userId,
          date: { gte: recentStart, lte: weekEnd },
        },
      });

      const utilization = await this.utilization(userId, dateStr);

      return {
        today: this.counters(todayTasks),
        week: this.counters(weekTasks),
        utilization,
        effort: buildEffortSummary({
          date: dateStr,
          todayTasks: this.asEffortTasks(todayTasks),
          weekTasks: this.asEffortTasks(weekTasks),
          recentTasks: this.asEffortTasks(recentTasks),
          utilizationPercent: utilization.utilizationPercent,
        }),
      };
    } catch {
      return this.local.overview(userId, dateStr);
    }
  }

  async utilization(
    userId: string,
    dateStr: string,
  ): Promise<DayUtilizationDto> {
    if (this.db.useDb()) {
      try {
        const id = await this.db.resolveUserId(userId);
        const tasks = await this.supabase.listTasks(id, dateStr);
        return this.utilizationFromTasks(id, dateStr, tasks);
      } catch (err) {
        console.warn(
          '[stats] DB utilization failed',
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (userId.startsWith('local_')) {
      return this.local.utilization(userId, dateStr);
    }
    try {
      const { availableMinutes } = await this.scheduler.getAvailableIntervals(
        userId,
        dateStr,
      );
      const day = dateOnly(dateStr);
      const tasks = await this.prisma.task.findMany({
        where: { userId, date: day },
      });
      const scheduledMinutes = tasks.reduce(
        (sum, t) => sum + t.estimatedMinutes,
        0,
      );
      const utilizationPercent =
        availableMinutes === 0
          ? 0
          : Math.round((scheduledMinutes / availableMinutes) * 100);
      return {
        date: dateStr,
        availableMinutes,
        scheduledMinutes,
        utilizationPercent,
        tip: "Don't go over 80% utilization — leave room for ad-hoc tasks.",
      };
    } catch {
      return this.local.utilization(userId, dateStr);
    }
  }

  async weeklyReport(
    userId: string,
    dateStr: string,
  ): Promise<WeeklyReportDto> {
    if (this.db.useDb()) {
      try {
        const id = await this.db.resolveUserId(userId);
        const day = dateOnly(dateStr);
        const weekStart = startOfWeek(day);
        const weekEnd = addDays(weekStart, 6);
        const tasks = await this.supabase.listTasksInRange(
          id,
          formatDateOnly(weekStart),
          formatDateOnly(weekEnd),
        );
        return this.buildWeekly(
          formatDateOnly(weekStart),
          formatDateOnly(weekEnd),
          tasks.map((t) => ({
            id: t.id,
            name: t.name,
            date: t.date,
            estimatedMinutes: t.estimatedMinutes,
            actualMinutes: t.actualMinutes ?? 0,
            status: t.status,
            scheduleLocked: Boolean(t.scheduleLocked),
            scheduledStart: t.scheduledStart,
            scheduledEnd: t.scheduledEnd,
          })),
        );
      } catch (err) {
        console.warn(
          '[stats] DB weekly failed',
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (userId.startsWith('local_')) {
      return this.local.weeklyReport(userId, dateStr);
    }
    try {
      const day = dateOnly(dateStr);
      const weekStart = startOfWeek(day);
      const weekEnd = addDays(weekStart, 6);

      const tasks = await this.prisma.task.findMany({
        where: {
          userId,
          date: { gte: weekStart, lte: weekEnd },
        },
        include: { timeEntries: true },
        orderBy: [{ date: 'asc' }, { order: 'asc' }],
      });

      return this.buildWeekly(
        formatDateOnly(weekStart),
        formatDateOnly(weekEnd),
        tasks.map((t) => ({
          id: t.id,
          name: t.name,
          date: formatDateOnly(t.date),
          estimatedMinutes: t.estimatedMinutes,
          actualMinutes: t.timeEntries.reduce(
            (sum, e) => sum + (e.actualMinutes ?? 0),
            0,
          ),
          status: t.status,
          scheduleLocked: Boolean(t.scheduleLocked),
          scheduledStart: t.scheduledStart?.toISOString() ?? null,
          scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
        })),
      );
    } catch {
      return this.local.weeklyReport(userId, dateStr);
    }
  }

  async eodSheet(userId: string, dateStr: string): Promise<EodSheetDto> {
    let tasks: TaskLike[] = [];
    if (this.db.useDb()) {
      try {
        const id = await this.db.resolveUserId(userId);
        const list = await this.supabase.listTasks(id, dateStr);
        tasks = list.map((t) => ({
          id: t.id,
          name: t.name,
          date: t.date,
          estimatedMinutes: t.estimatedMinutes,
          actualMinutes: t.actualMinutes ?? 0,
          status: t.status,
          scheduleLocked: Boolean(t.scheduleLocked),
          scheduledStart: t.scheduledStart,
          scheduledEnd: t.scheduledEnd,
          meetLink: t.meetLink ?? null,
          notes: t.notes ?? null,
        }));
      } catch (err) {
        console.warn(
          '[stats] DB eod failed',
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (!tasks.length && userId.startsWith('local_')) {
      return this.local.eodSheet(userId, dateStr);
    }
    if (!tasks.length) {
      try {
        const day = dateOnly(dateStr);
        const rows = await this.prisma.task.findMany({
          where: { userId, date: day },
          include: { timeEntries: true },
          orderBy: { order: 'asc' },
        });
        tasks = rows.map((t) => ({
          id: t.id,
          name: t.name,
          date: dateStr,
          estimatedMinutes: t.estimatedMinutes,
          actualMinutes: t.timeEntries.reduce(
            (sum, e) => sum + (e.actualMinutes ?? 0),
            0,
          ),
          status: t.status,
          scheduleLocked: Boolean(t.scheduleLocked),
          scheduledStart: t.scheduledStart?.toISOString() ?? null,
          scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
          meetLink: t.meetLink ?? null,
          notes: t.notes ?? null,
        }));
      } catch {
        return this.local.eodSheet(userId, dateStr);
      }
    }
    return this.buildEod(dateStr, tasks);
  }

  private buildWeekly(
    weekStart: string,
    weekEnd: string,
    tasks: TaskLike[],
  ): WeeklyReportDto {
    const byDayMap = new Map<string, WeeklyReportDayDto>();
    const start = dateOnly(weekStart);
    for (let i = 0; i < 7; i++) {
      const d = formatDateOnly(addDays(start, i));
      byDayMap.set(d, {
        date: d,
        estimatedMinutes: 0,
        actualMinutes: 0,
        total: 0,
        completed: 0,
        pending: 0,
        completionPercent: 0,
      });
    }

    const byTask: WeeklyReportTaskDto[] = tasks.map((t) => {
      const actualMinutes = t.actualMinutes ?? 0;
      const status = (t.status === 'completed'
        ? 'completed'
        : t.status === 'in_progress'
          ? 'in_progress'
          : 'pending') as TaskStatus;
      const bucket = byDayMap.get(t.date);
      if (bucket) {
        bucket.estimatedMinutes += t.estimatedMinutes;
        bucket.actualMinutes += actualMinutes;
        bucket.total += 1;
        if (status === 'completed') bucket.completed += 1;
        else bucket.pending += 1;
      }
      return {
        taskId: t.id,
        name: t.name,
        date: t.date,
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes,
        status,
        varianceMinutes: actualMinutes - t.estimatedMinutes,
        scheduleLocked: Boolean(t.scheduleLocked),
        scheduledStart: t.scheduledStart ? String(t.scheduledStart) : null,
        scheduledEnd: t.scheduledEnd ? String(t.scheduledEnd) : null,
      };
    });

    const byDay = [...byDayMap.values()].map((d) => ({
      ...d,
      completionPercent:
        d.total === 0 ? 0 : Math.round((d.completed / d.total) * 100),
    }));

    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const pending = total - completed;
    const totals = {
      estimatedMinutes: byDay.reduce((s, d) => s + d.estimatedMinutes, 0),
      actualMinutes: byDay.reduce((s, d) => s + d.actualMinutes, 0),
      total,
      completed,
      pending,
      completionPercent:
        total === 0 ? 0 : Math.round((completed / total) * 100),
    };

    return { weekStart, weekEnd, byDay, byTask, totals };
  }

  private buildEod(dateStr: string, tasks: TaskLike[]): EodSheetDto {
    const rows = tasks.map((t) => {
      const status = (t.status === 'completed'
        ? 'completed'
        : t.status === 'in_progress'
          ? 'in_progress'
          : 'pending') as TaskStatus;
      const actualMinutes = t.actualMinutes ?? 0;
      return {
        id: t.id,
        name: t.name,
        status,
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes,
        varianceMinutes: actualMinutes - t.estimatedMinutes,
        scheduledStart: t.scheduledStart ? String(t.scheduledStart) : null,
        scheduledEnd: t.scheduledEnd ? String(t.scheduledEnd) : null,
        scheduleLocked: Boolean(t.scheduleLocked),
        meetLink: t.meetLink ?? null,
        notes: t.notes ?? null,
      };
    });
    const total = rows.length;
    const completed = rows.filter((t) => t.status === 'completed').length;
    const inProgress = rows.filter((t) => t.status === 'in_progress').length;
    const pending = total - completed;
    return {
      date: dateStr,
      generatedAt: new Date().toISOString(),
      summary: {
        total,
        completed,
        pending,
        inProgress,
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
  }

  private async utilizationFromTasks(
    dbUserId: string,
    dateStr: string,
    tasks: Array<{ estimatedMinutes: number }>,
  ): Promise<DayUtilizationDto> {
    let availableMinutes = 8 * 60;
    try {
      const day = dateOnly(dateStr);
      const weekday = day.getUTCDay();
      const schedules = await this.supabase.listSchedule(dbUserId);
      const template = schedules.find((s) => s.weekday === weekday);
      if (template) {
        const [wsH, wsM] = template.workStart.split(':').map(Number);
        const [weH, weM] = template.workEnd.split(':').map(Number);
        availableMinutes = weH * 60 + weM - (wsH * 60 + wsM);
        for (const b of template.breaks) {
          const [bsH, bsM] = b.start.split(':').map(Number);
          const [beH, beM] = b.end.split(':').map(Number);
          availableMinutes -= beH * 60 + beM - (bsH * 60 + bsM);
        }
        availableMinutes = Math.max(0, availableMinutes);
      }
    } catch {
      /* default 8h */
    }

    const scheduledMinutes = tasks.reduce(
      (sum, t) => sum + t.estimatedMinutes,
      0,
    );
    const utilizationPercent =
      availableMinutes === 0
        ? 0
        : Math.round((scheduledMinutes / availableMinutes) * 100);

    return {
      date: dateStr,
      availableMinutes,
      scheduledMinutes,
      utilizationPercent,
      tip: "Don't go over 80% utilization — leave room for ad-hoc tasks.",
    };
  }

  private counters(
    tasks: Array<{ status: string }>,
  ): { total: number; completed: number; pending: number } {
    const completed = tasks.filter((t) => t.status === 'completed').length;
    return {
      total: tasks.length,
      completed,
      pending: tasks.length - completed,
    };
  }

  private asEffortTasks(
    tasks: Array<{
      date: string | Date;
      name?: string;
      status: string;
      estimatedMinutes?: number;
      actualMinutes?: number;
      scheduleLocked?: boolean;
    }>,
  ) {
    return tasks.map((t) => ({
      date:
        typeof t.date === 'string'
          ? t.date.slice(0, 10)
          : formatDateOnly(t.date),
      name: t.name,
      status: t.status,
      estimatedMinutes: t.estimatedMinutes,
      actualMinutes: t.actualMinutes,
      scheduleLocked: t.scheduleLocked,
    }));
  }
}
