import { Injectable } from '@nestjs/common';
import type {
  DailyScheduleTemplateDto,
  UpsertScheduleTemplateDto,
  Weekday,
} from '@timeblock/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../tasks/scheduler.service';
import { LocalDataStore } from '../auth/local-data.store';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
import { addDays, formatDateOnly, todayInTimeZone, normalizeTimeZone } from '../common/time.util';

@Injectable()
export class ScheduleTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly local: LocalDataStore,
    private readonly supabase: SupabaseRestService,
    private readonly db: DbBridgeService,
  ) {}

  private async viaDb<T>(
    userId: string,
    fn: (dbUserId: string) => Promise<T>,
  ): Promise<T | null> {
    if (!this.db.useDb()) return null;
    try {
      const id = await this.db.resolveUserId(userId);
      return await fn(id);
    } catch (err) {
      console.warn(
        '[schedule] DB failed',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  private async rescheduleAfter(dbUserId: string) {
    let tz = 'UTC';
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: dbUserId },
        select: { timezone: true },
      });
      if (user?.timezone) tz = normalizeTimeZone(user.timezone);
    } catch {
      if (this.supabase.isConfigured()) {
        const user = await this.supabase.getUserById(dbUserId);
        if (user?.timezone) tz = normalizeTimeZone(user.timezone);
      }
    }
    const todayStr = todayInTimeZone(tz);
    for (let i = 0; i < 7; i++) {
      const [y, m, d] = todayStr.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + i));
      const dateStr = formatDateOnly(next);
      try {
        await this.scheduler.rescheduleDayPreferRest(dbUserId, dateStr);
      } catch {
        /* ignore */
      }
    }
  }

  async list(userId: string): Promise<DailyScheduleTemplateDto[]> {
    const fromDb = await this.viaDb(
      userId,
      (id) =>
        this.supabase.listSchedule(id) as Promise<DailyScheduleTemplateDto[]>,
    );
    if (fromDb) return fromDb;

    if (userId.startsWith('local_')) {
      return this.local.listSchedule(userId);
    }
    try {
      const rows = await this.prisma.dailyScheduleTemplate.findMany({
        where: { userId },
        include: { breaks: true },
        orderBy: { weekday: 'asc' },
      });
      return rows.map((r) => this.map(r));
    } catch {
      return this.local.listSchedule(userId);
    }
  }

  async upsert(
    userId: string,
    dto: UpsertScheduleTemplateDto,
  ): Promise<DailyScheduleTemplateDto> {
    const fromDb = await this.viaDb(
      userId,
      async (id) => {
        const row = await this.supabase.upsertSchedule(id, dto);
        await this.rescheduleAfter(id);
        return row as DailyScheduleTemplateDto;
      },
    );
    if (fromDb) return fromDb;

    if (userId.startsWith('local_')) {
      return this.local.upsertSchedule(userId, dto);
    }
    try {
      const result = await this.writeTemplate(userId, dto);
      await this.rescheduleUpcoming(userId);
      return result;
    } catch {
      return this.local.upsertSchedule(userId, dto);
    }
  }

  async applyToAllDays(
    userId: string,
    dto: Omit<UpsertScheduleTemplateDto, 'weekday'>,
  ): Promise<DailyScheduleTemplateDto[]> {
    const fromDb = await this.viaDb(userId, async (id) => {
      const weekdays: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
      for (const weekday of weekdays) {
        await this.supabase.upsertSchedule(id, { ...dto, weekday });
      }
      await this.rescheduleAfter(id);
      return this.supabase.listSchedule(id) as Promise<DailyScheduleTemplateDto[]>;
    });
    if (fromDb) return fromDb;

    if (userId.startsWith('local_')) {
      return this.local.applyScheduleToAll(userId, dto);
    }
    try {
      const weekdays: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
      for (const weekday of weekdays) {
        await this.writeTemplate(userId, { ...dto, weekday });
      }
      await this.rescheduleUpcoming(userId);
      return this.list(userId);
    } catch {
      return this.local.applyScheduleToAll(userId, dto);
    }
  }

  private async writeTemplate(
    userId: string,
    dto: UpsertScheduleTemplateDto,
  ): Promise<DailyScheduleTemplateDto> {
    const existing = await this.prisma.dailyScheduleTemplate.findUnique({
      where: {
        userId_weekday: { userId, weekday: dto.weekday },
      },
    });

    if (existing) {
      await this.prisma.break.deleteMany({ where: { templateId: existing.id } });
      const updated = await this.prisma.dailyScheduleTemplate.update({
        where: { id: existing.id },
        data: {
          workStart: dto.workStart,
          workEnd: dto.workEnd,
          breaks: {
            create: dto.breaks.map((b) => ({
              name: b.name,
              start: b.start,
              end: b.end,
            })),
          },
        },
        include: { breaks: true },
      });
      return this.map(updated);
    }

    const created = await this.prisma.dailyScheduleTemplate.create({
      data: {
        userId,
        weekday: dto.weekday,
        workStart: dto.workStart,
        workEnd: dto.workEnd,
        breaks: {
          create: dto.breaks.map((b) => ({
            name: b.name,
            start: b.start,
            end: b.end,
          })),
        },
      },
      include: { breaks: true },
    });
    return this.map(created);
  }

  private async rescheduleUpcoming(userId: string) {
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = formatDateOnly(addDays(today, i));
      try {
        await this.scheduler.rescheduleDay(userId, d);
      } catch {
        /* skip when Prisma down */
      }
    }
  }

  private map(r: {
    id: string;
    weekday: number;
    workStart: string;
    workEnd: string;
    breaks: Array<{ id: string; name: string; start: string; end: string }>;
  }): DailyScheduleTemplateDto {
    return {
      id: r.id,
      weekday: r.weekday as DailyScheduleTemplateDto['weekday'],
      workStart: r.workStart,
      workEnd: r.workEnd,
      breaks: r.breaks.map((b) => ({
        id: b.id,
        name: b.name,
        start: b.start,
        end: b.end,
      })),
    };
  }
}
