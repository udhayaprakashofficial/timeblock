import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type {
  CreateRecurringTaskDto,
  CreateTaskDto,
  RecurringTaskDto,
  ScheduleBacklogTaskDto,
  TaskDto,
  UpdateTaskDto,
  Weekday,
} from '@timeblock/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from './scheduler.service';
import { LocalDataStore } from '../auth/local-data.store';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
import {
  combineDateAndMinutes,
  dateOnly,
  formatDateOnly,
  normalizeTimeZone,
  parseHm,
  todayInTimeZone,
} from '../common/time.util';

type ResolvedCreate = CreateTaskDto & {
  name: string;
  estimatedMinutes: number;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  scheduleLocked: boolean;
};

@Injectable()
export class TasksService {
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
        '[tasks] DB write failed',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

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
    if (this.supabase.isConfigured()) {
      const user = await this.supabase.getUserById(userId);
      if (user?.timezone) return normalizeTimeZone(user.timezone);
    }
    return 'UTC';
  }

  private async resolveDefaultMinutes(userId: string): Promise<number> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { defaultTaskMinutes: true },
      });
      if (user?.defaultTaskMinutes && user.defaultTaskMinutes >= 5) {
        return user.defaultTaskMinutes;
      }
    } catch {
      /* REST fallback */
    }
    if (this.supabase.isConfigured()) {
      try {
        const rows = await this.supabase.select<{ defaultTaskMinutes?: number }>(
          'User',
          'defaultTaskMinutes',
          { filter: `id=eq.${userId}`, limit: 1 },
        );
        const n = Number(rows[0]?.defaultTaskMinutes);
        if (Number.isFinite(n) && n >= 5) return Math.round(n);
      } catch {
        /* column may not exist yet */
      }
    }
    return 30;
  }

  private async resolveCreatePayload(
    userId: string,
    dto: CreateTaskDto,
  ): Promise<ResolvedCreate> {
    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException('Task name is required');
    }

    const startTime = dto.startTime?.trim();
    const endTime = dto.endTime?.trim();
    if (startTime || endTime) {
      if (!startTime || !endTime) {
        throw new BadRequestException('Both start and end time are required');
      }
      let startMin: number;
      let endMin: number;
      try {
        startMin = parseHm(startTime);
        endMin = parseHm(endTime);
      } catch {
        throw new BadRequestException('Times must be HH:MM');
      }
      if (!(endMin > startMin)) {
        throw new BadRequestException('End time must be after start time');
      }
      const estimatedMinutes = endMin - startMin;
      if (estimatedMinutes < 5) {
        throw new BadRequestException('Slot must be at least 5 minutes');
      }
      const tz = await this.resolveTimeZone(userId);
      return {
        ...dto,
        name,
        estimatedMinutes,
        scheduledStart: combineDateAndMinutes(dto.date, startMin, tz),
        scheduledEnd: combineDateAndMinutes(dto.date, endMin, tz),
        scheduleLocked: true,
      };
    }

    let estimatedMinutes =
      dto.estimatedMinutes != null ? Number(dto.estimatedMinutes) : NaN;
    if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 5) {
      estimatedMinutes = await this.resolveDefaultMinutes(userId);
    }
    if (estimatedMinutes < 5) {
      throw new BadRequestException('Estimated minutes must be at least 5');
    }
    return {
      ...dto,
      name,
      estimatedMinutes: Math.round(estimatedMinutes),
      scheduledStart: null,
      scheduledEnd: null,
      scheduleLocked: false,
    };
  }

  /** Move unfinished non-meeting tasks from past days into the backlog. */
  async carryOverUnfinished(userId: string): Promise<number> {
    const tz = await this.resolveTimeZone(userId);
    const today = todayInTimeZone(tz);

    const fromDb = await this.viaDb(userId, async (id) => {
      return this.supabase.carryOverUnfinished(id, today);
    });
    if (fromDb != null) return fromDb;

    if (userId.startsWith('local_')) {
      return this.local.carryOverUnfinished(userId, today);
    }
    try {
      const result = await this.prisma.task.updateMany({
        where: {
          userId,
          inBacklog: false,
          scheduleLocked: false,
          status: { in: ['pending', 'in_progress'] },
          date: { lt: dateOnly(today) },
        },
        data: {
          inBacklog: true,
          scheduledStart: null,
          scheduledEnd: null,
        },
      });
      return result.count;
    } catch {
      return this.local.carryOverUnfinished(userId, today);
    }
  }

  /** Move unfinished tasks from one civil day onto another and clear backlog flag. */
  async moveUnfinishedDayToDate(
    userId: string,
    fromDate: string,
    toDate: string,
  ): Promise<number> {
    if (!fromDate || !toDate || fromDate === toDate) return 0;

    const fromDb = await this.viaDb(userId, async (id) => {
      const rows = await this.supabase.select<{ id: string }>(
        'Task',
        'id',
        {
          filter: `userId=eq.${id}&date=eq.${fromDate}&scheduleLocked=eq.false&status=in.(pending,in_progress)`,
        },
      );
      const now = new Date().toISOString();
      let orderBase = 0;
      try {
        const existing = await this.supabase.select<{ order: number }>(
          'Task',
          'order',
          {
            filter: `userId=eq.${id}&date=eq.${toDate}&inBacklog=eq.false`,
            order: 'order.desc',
            limit: 1,
          },
        );
        orderBase = (existing[0]?.order ?? -1) + 1;
      } catch {
        orderBase = 0;
      }
      let n = 0;
      for (const row of rows) {
        await this.supabase.patch('Task', `id=eq.${row.id}`, {
          date: toDate,
          inBacklog: false,
          scheduledStart: null,
          scheduledEnd: null,
          scheduleLocked: false,
          order: orderBase + n,
          updatedAt: now,
        });
        n += 1;
      }
      return n;
    });
    if (fromDb != null) return fromDb;

    if (userId.startsWith('local_')) {
      return this.local.moveUnfinishedDayToDate(userId, fromDate, toDate);
    }
    try {
      const tasks = await this.prisma.task.findMany({
        where: {
          userId,
          date: dateOnly(fromDate),
          scheduleLocked: false,
          status: { in: ['pending', 'in_progress'] },
        },
        orderBy: { order: 'asc' },
      });
      if (!tasks.length) return 0;
      const max = await this.prisma.task.aggregate({
        where: { userId, date: dateOnly(toDate), inBacklog: false },
        _max: { order: true },
      });
      let order = (max._max.order ?? -1) + 1;
      for (const t of tasks) {
        await this.prisma.task.update({
          where: { id: t.id },
          data: {
            date: dateOnly(toDate),
            inBacklog: false,
            scheduledStart: null,
            scheduledEnd: null,
            scheduleLocked: false,
            order: order++,
          },
        });
      }
      return tasks.length;
    } catch {
      return this.local.moveUnfinishedDayToDate(userId, fromDate, toDate);
    }
  }

  /**
   * If today's plan is empty but backlog has unfinished work from yesterday
   * (or same day that failed packing), put those on the plan once.
   * Fixes UTC-vs-local onboarding seed without surprising users who already
   * have a populated day.
   */
  private async placeBacklogOnEmptyToday(
    userId: string,
    dateStr: string,
  ): Promise<void> {
    const tz = await this.resolveTimeZone(userId);
    const today = todayInTimeZone(tz);
    if (dateStr !== today) return;

    const yesterday = (() => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    const fromDb = await this.viaDb(userId, async (id) => {
      const planned = (
        await this.supabase.listTasks(id, today)
      ).filter((t) => !t.inBacklog);
      if (planned.length > 0) return 0;
      const backlog = await this.supabase.listBacklogTasks(id);
      const seen = new Set<string>();
      const candidates = backlog.filter((t) => {
        if (t.status === 'completed' || t.scheduleLocked) return false;
        if (t.date !== yesterday && t.date !== today) return false;
        const key = t.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!candidates.length) return 0;
      for (const t of candidates) {
        await this.supabase.scheduleFromBacklog(id, t.id, today);
      }
      await this.scheduler.rescheduleDayPreferRest(id, today);
      return candidates.length;
    });
    if (fromDb != null) return;

    const planned = this.local.listTasks(userId, today);
    if (planned.length > 0) return;
    const backlog = this.local.listBacklog(userId);
    const seen = new Set<string>();
    const candidates = backlog.filter((t) => {
      if (t.status === 'completed' || t.scheduleLocked) return false;
      if (t.date !== yesterday && t.date !== today) return false;
      const key = t.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!candidates.length) return;
    for (const t of candidates) {
      this.local.scheduleFromBacklog(userId, t.id, today);
    }
  }

  async list(userId: string, dateStr: string): Promise<TaskDto[]> {
    await this.carryOverUnfinished(userId);
    await this.placeBacklogOnEmptyToday(userId, dateStr);
    await this.materializeRecurring(userId, dateStr);

    const fromDb = await this.viaDb(userId, (id) =>
      this.supabase.listTasks(id, dateStr) as Promise<TaskDto[]>,
    );
    if (fromDb) return fromDb.filter((t) => !t.inBacklog);

    if (userId.startsWith('local_')) {
      return this.local.listTasks(userId, dateStr);
    }
    try {
      const day = dateOnly(dateStr);
      const tasks = await this.prisma.task.findMany({
        where: { userId, date: day, inBacklog: false },
        include: { timeEntries: true },
        orderBy: { order: 'asc' },
      });
      return tasks.map((t) => this.mapTask(t));
    } catch {
      return this.local.listTasks(userId, dateStr);
    }
  }

  async listRecurring(userId: string): Promise<RecurringTaskDto[]> {
    const fromDb = await this.viaDb(userId, async (id) => {
      const rows = await this.supabase.listRecurringTemplates(id);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        estimatedMinutes: r.estimatedMinutes,
        weekdays: r.weekdays as Weekday[],
        active: r.active,
      }));
    });
    if (fromDb) return fromDb;

    if (userId.startsWith('local_')) {
      return this.local.listRecurring(userId);
    }
    try {
      const rows = await this.prisma.recurringTaskTemplate.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        estimatedMinutes: r.estimatedMinutes,
        weekdays: (Array.isArray(r.weekdays) ? r.weekdays : []) as Weekday[],
        active: r.active,
      }));
    } catch {
      return this.local.listRecurring(userId);
    }
  }

  async createRecurring(
    userId: string,
    dto: CreateRecurringTaskDto,
  ): Promise<RecurringTaskDto> {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Name is required');
    const weekdays = [...new Set(dto.weekdays ?? [])].filter(
      (d) => d >= 0 && d <= 6,
    ) as Weekday[];
    if (!weekdays.length) {
      throw new BadRequestException('Pick at least one weekday');
    }
    let estimatedMinutes = Number(dto.estimatedMinutes);
    if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 5) {
      estimatedMinutes = 30;
    }
    estimatedMinutes = Math.min(480, Math.round(estimatedMinutes));

    const payload = {
      name,
      estimatedMinutes,
      weekdays,
      active: dto.active !== false,
    };

    const fromDb = await this.viaDb(userId, async (id) => {
      return this.supabase.createRecurringTemplate(id, payload);
    });
    if (fromDb) {
      const tz = await this.resolveTimeZone(userId);
      await this.materializeRecurring(userId, todayInTimeZone(tz));
      return {
        id: fromDb.id,
        name: fromDb.name,
        estimatedMinutes: fromDb.estimatedMinutes,
        weekdays: fromDb.weekdays as Weekday[],
        active: fromDb.active,
      };
    }

    // When REST is configured, skip Prisma (often unreachable) and write
    // today's task into the primary Task store so the dashboard list sees it.
    if (userId.startsWith('local_') || this.db.useDb()) {
      const created = this.local.createRecurring(userId, payload);
      const tz = await this.resolveTimeZone(userId);
      const today = todayInTimeZone(tz);
      this.local.materializeRecurring(userId, today);
      if (this.db.useDb()) {
        try {
          await this.create(userId, {
            date: today,
            name: payload.name,
            estimatedMinutes: payload.estimatedMinutes,
          });
        } catch {
          /* local copy remains */
        }
      }
      return created;
    }
    try {
      const created = await this.prisma.recurringTaskTemplate.create({
        data: {
          userId,
          name: payload.name,
          estimatedMinutes: payload.estimatedMinutes,
          weekdays: payload.weekdays,
          active: payload.active,
        },
      });
      const tz = await this.resolveTimeZone(userId);
      await this.materializeRecurring(userId, todayInTimeZone(tz));
      return {
        id: created.id,
        name: created.name,
        estimatedMinutes: created.estimatedMinutes,
        weekdays: (Array.isArray(created.weekdays)
          ? created.weekdays
          : []) as Weekday[],
        active: created.active,
      };
    } catch {
      const created = this.local.createRecurring(userId, payload);
      const tz = await this.resolveTimeZone(userId);
      const today = todayInTimeZone(tz);
      this.local.materializeRecurring(userId, today);
      try {
        await this.create(userId, {
          date: today,
          name: payload.name,
          estimatedMinutes: payload.estimatedMinutes,
        });
      } catch {
        /* local materialize already has a copy */
      }
      return created;
    }
  }

  async deleteRecurring(userId: string, id: string): Promise<{ ok: true }> {
    const fromDb = await this.viaDb(userId, async (uid) => {
      await this.supabase.deleteRecurringTemplate(uid, id);
      return { ok: true as const };
    });
    if (fromDb) return fromDb;

    if (userId.startsWith('local_')) {
      this.local.deleteRecurring(userId, id);
      return { ok: true };
    }
    try {
      await this.prisma.recurringTaskTemplate.deleteMany({
        where: { id, userId },
      });
      return { ok: true };
    } catch {
      this.local.deleteRecurring(userId, id);
      return { ok: true };
    }
  }

  /** Create Task rows for active templates that match this calendar date. */
  async materializeRecurring(userId: string, dateStr: string): Promise<number> {
    const day = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(day.getTime())) return 0;
    const weekday = day.getDay() as Weekday;

    const fromDb = await this.viaDb(userId, async (id) => {
      const templates = (await this.supabase.listRecurringTemplates(id)).filter(
        (t) => t.active && t.weekdays.includes(weekday),
      );
      let created = 0;
      for (const t of templates) {
        const externalId = `${t.id}:${dateStr}`;
        try {
          const before = await this.supabase.listTasks(id, dateStr);
          if (
            before.some(
              (x) =>
                x.sourceProvider === 'recurring' &&
                x.sourceExternalId === externalId,
            )
          ) {
            continue;
          }
          // Also skip if sourceExternalId isn't returned — check by notes pattern via name+provider
          await this.supabase.createTask(id, {
            date: dateStr,
            name: t.name,
            estimatedMinutes: t.estimatedMinutes,
            sourceProvider: 'recurring',
            sourceExternalId: externalId,
          });
          created += 1;
        } catch {
          /* ignore one template failure */
        }
      }
      if (created) {
        await this.scheduler.rescheduleDayPreferRest(id, dateStr);
      }
      return created;
    });
    if (fromDb != null) return fromDb;

    if (userId.startsWith('local_')) {
      const n = this.local.materializeRecurring(userId, dateStr);
      return n;
    }
    try {
      const templates = await this.prisma.recurringTaskTemplate.findMany({
        where: { userId, active: true },
      });
      let created = 0;
      for (const t of templates) {
        const days = (Array.isArray(t.weekdays) ? t.weekdays : []) as number[];
        if (!days.includes(weekday)) continue;
        const externalId = `${t.id}:${dateStr}`;
        const existing = await this.prisma.task.findFirst({
          where: {
            userId,
            sourceProvider: 'recurring',
            sourceExternalId: externalId,
          },
        });
        if (existing) continue;
        const max = await this.prisma.task.aggregate({
          where: { userId, date: dateOnly(dateStr), inBacklog: false },
          _max: { order: true },
        });
        await this.prisma.task.create({
          data: {
            userId,
            date: dateOnly(dateStr),
            name: t.name,
            estimatedMinutes: t.estimatedMinutes,
            order: (max._max.order ?? -1) + 1,
            sourceProvider: 'recurring',
            sourceExternalId: externalId,
            inBacklog: false,
          },
        });
        created += 1;
      }
      if (created) await this.scheduler.rescheduleDay(userId, dateStr);
      return created;
    } catch {
      return this.local.materializeRecurring(userId, dateStr);
    }
  }

  async listBacklog(userId: string): Promise<TaskDto[]> {
    await this.carryOverUnfinished(userId);

    const fromDb = await this.viaDb(userId, (id) =>
      this.supabase.listBacklogTasks(id),
    );
    if (fromDb) return fromDb;

    if (userId.startsWith('local_')) {
      return this.local.listBacklog(userId);
    }
    try {
      const tasks = await this.prisma.task.findMany({
        where: {
          userId,
          inBacklog: true,
          status: { in: ['pending', 'in_progress'] },
        },
        include: { timeEntries: true },
        orderBy: [{ date: 'asc' }, { order: 'asc' }],
      });
      return tasks.map((t) => this.mapTask(t));
    } catch {
      return this.local.listBacklog(userId);
    }
  }

  /**
   * Fast onboarding seed: create today's tasks once, reschedule once,
   * then best-effort recurring templates (no per-template materialize).
   */
  async seedOnboarding(
    userId: string,
    plans: Array<{
      name: string;
      estimatedMinutes: number;
      recurring?: boolean;
    }>,
    weekdays: Weekday[],
  ): Promise<TaskDto[]> {
    const tz = await this.resolveTimeZone(userId);
    const today = todayInTimeZone(tz);
    const cleaned = plans
      .map((p) => ({
        name: (p.name ?? '').trim(),
        estimatedMinutes: Math.max(
          5,
          Math.min(480, Math.round(Number(p.estimatedMinutes) || 30)),
        ),
        recurring: Boolean(p.recurring),
      }))
      .filter((p) => p.name);

    if (!cleaned.length) return this.list(userId, today);

    const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6) as Weekday[];

    const fromDb = await this.viaDb(userId, async (id) => {
      // Sequential creates so order stays stable; skip per-task reschedule.
      for (const p of cleaned) {
        await this.supabase.createTask(id, {
          date: today,
          name: p.name,
          estimatedMinutes: p.estimatedMinutes,
          inBacklog: false,
        });
      }
      await this.scheduler.rescheduleDayPreferRest(id, today);

      // Recurring templates — fire in parallel, ignore failures (table may be missing)
      await Promise.all(
        cleaned
          .filter((p) => p.recurring && days.length)
          .map((p) =>
            this.supabase
              .createRecurringTemplate(id, {
                name: p.name,
                estimatedMinutes: p.estimatedMinutes,
                weekdays: days,
                active: true,
              })
              .catch(() => null),
          ),
      );

      return this.supabase.listTasks(id, today) as Promise<TaskDto[]>;
    });
    if (fromDb) return fromDb.filter((t) => !t.inBacklog);

    // Local / offline path
    for (const p of cleaned) {
      this.local.createTask(userId, {
        date: today,
        name: p.name,
        estimatedMinutes: p.estimatedMinutes,
      });
      if (p.recurring && days.length) {
        this.local.createRecurring(userId, {
          name: p.name,
          estimatedMinutes: p.estimatedMinutes,
          weekdays: days,
          active: true,
        });
      }
    }
    return this.local.listTasks(userId, today);
  }

  async create(userId: string, dto: CreateTaskDto): Promise<TaskDto> {
    let tzUserId = userId;
    if (this.db.useDb()) {
      try {
        tzUserId = await this.db.resolveUserId(userId);
      } catch {
        /* keep session id */
      }
    }
    const payload = await this.resolveCreatePayload(tzUserId, dto);

    const fromDb = await this.viaDb(userId, async (id) => {
      const created = await this.supabase.createTask(id, {
        date: payload.date,
        name: payload.name,
        estimatedMinutes: payload.estimatedMinutes,
        scheduledStart: payload.scheduledStart?.toISOString() ?? null,
        scheduledEnd: payload.scheduledEnd?.toISOString() ?? null,
        scheduleLocked: payload.scheduleLocked,
        inBacklog: false,
      });
      await this.scheduler.rescheduleDayPreferRest(id, payload.date);
      const list = await this.supabase.listTasks(id, payload.date);
      const backlog = await this.supabase.listBacklogTasks(id);
      return (
        list.find((t) => t.id === created.id) ??
        backlog.find((t) => t.id === created.id) ??
        list.find((t) => t.name === payload.name && t.date === payload.date) ??
        created
      );
    });
    if (fromDb) return fromDb as TaskDto;

    if (userId.startsWith('local_')) {
      return this.local.createTask(userId, payload);
    }
    try {
      const day = dateOnly(payload.date);
      const max = await this.prisma.task.aggregate({
        where: { userId, date: day, inBacklog: false },
        _max: { order: true },
      });
      const order = (max._max.order ?? -1) + 1;
      const task = await this.prisma.task.create({
        data: {
          userId,
          date: day,
          name: payload.name,
          estimatedMinutes: payload.estimatedMinutes,
          order,
          scheduledStart: payload.scheduledStart,
          scheduledEnd: payload.scheduledEnd,
          scheduleLocked: payload.scheduleLocked,
          inBacklog: false,
        },
        include: { timeEntries: true },
      });
      await this.scheduler.rescheduleDay(userId, payload.date);
      const refreshed = await this.prisma.task.findUnique({
        where: { id: task.id },
        include: { timeEntries: true },
      });
      return this.mapTask(refreshed!);
    } catch {
      return this.local.createTask(userId, payload);
    }
  }

  async scheduleFromBacklog(
    userId: string,
    taskId: string,
    dto: ScheduleBacklogTaskDto = {},
  ): Promise<TaskDto> {
    const tz = await this.resolveTimeZone(
      (await this.viaDb(userId, async (id) => id)) ?? userId,
    );
    const dateStr = dto.date?.trim() || todayInTimeZone(tz);

    const fromDb = await this.viaDb(userId, async (id) => {
      const task = await this.supabase.scheduleFromBacklog(id, taskId, dateStr);
      await this.scheduler.rescheduleDayPreferRest(id, dateStr);
      const list = await this.supabase.listTasks(id, dateStr);
      const backlog = await this.supabase.listBacklogTasks(id);
      return (
        list.find((t) => t.id === taskId) ??
        backlog.find((t) => t.id === taskId) ??
        task
      );
    });
    if (fromDb) return fromDb as TaskDto;

    if (userId.startsWith('local_')) {
      return this.local.scheduleFromBacklog(userId, taskId, dateStr);
    }
    try {
      const existing = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
      });
      if (!existing) throw new NotFoundException('Task not found');
      if (existing.status === 'completed') {
        throw new BadRequestException('Completed tasks cannot be rescheduled from backlog');
      }
      const day = dateOnly(dateStr);
      const max = await this.prisma.task.aggregate({
        where: { userId, date: day, inBacklog: false },
        _max: { order: true },
      });
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          date: day,
          inBacklog: false,
          scheduleLocked: false,
          scheduledStart: null,
          scheduledEnd: null,
          order: (max._max.order ?? -1) + 1,
          status:
            existing.status === 'in_progress' ? 'in_progress' : 'pending',
        },
      });
      await this.scheduler.rescheduleDay(userId, dateStr);
      const refreshed = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { timeEntries: true },
      });
      return this.mapTask(refreshed!);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        throw err;
      }
      return this.local.scheduleFromBacklog(userId, taskId, dateStr);
    }
  }

  async moveToBacklog(userId: string, taskId: string): Promise<TaskDto> {
    return this.update(userId, taskId, { inBacklog: true });
  }

  async reorder(
    userId: string,
    dateStr: string,
    taskIds: string[],
  ): Promise<TaskDto[]> {
    const fromDb = await this.viaDb(userId, async (id) => {
      for (let i = 0; i < taskIds.length; i++) {
        await this.supabase.patch(
          'Task',
          `id=eq.${taskIds[i]}&userId=eq.${id}`,
          { order: i, updatedAt: new Date().toISOString() },
        );
      }
      await this.scheduler.rescheduleDayPreferRest(id, dateStr);
      return this.supabase.listTasks(id, dateStr) as Promise<TaskDto[]>;
    });
    if (fromDb) return fromDb.filter((t) => !t.inBacklog);

    if (userId.startsWith('local_')) {
      return this.local.reorderTasks(userId, dateStr, taskIds);
    }
    try {
      const day = dateOnly(dateStr);
      await this.prisma.$transaction(
        taskIds.map((id, index) =>
          this.prisma.task.updateMany({
            where: { id, userId, date: day, inBacklog: false },
            data: { order: index },
          }),
        ),
      );
      await this.scheduler.rescheduleDay(userId, dateStr);
      return this.list(userId, dateStr);
    } catch {
      return this.local.reorderTasks(userId, dateStr, taskIds);
    }
  }

  async complete(userId: string, taskId: string): Promise<TaskDto> {
    const fromDb = await this.viaDb(userId, async (id) => {
      const task = await this.supabase.completeTask(id, taskId);
      if (!task.inBacklog) {
        await this.scheduler.rescheduleDayPreferRest(id, task.date);
      }
      const list = await this.supabase.listTasks(id, task.date);
      return list.find((t) => t.id === taskId) ?? task;
    });
    if (fromDb) return fromDb as TaskDto;

    if (userId.startsWith('local_')) {
      return this.local.completeTask(userId, taskId);
    }
    try {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
      });
      if (!task) throw new NotFoundException();
      const open = await this.prisma.timeEntry.findMany({
        where: { taskId, endedAt: null },
      });
      const now = new Date();
      for (const entry of open) {
        const actualMinutes = Math.max(
          1,
          Math.round((now.getTime() - entry.startedAt.getTime()) / 60000),
        );
        await this.prisma.timeEntry.update({
          where: { id: entry.id },
          data: { endedAt: now, actualMinutes },
        });
      }
      const closed = await this.prisma.timeEntry.findMany({
        where: { taskId, endedAt: { not: null } },
      });
      const logged = closed.reduce((s, e) => s + (e.actualMinutes ?? 0), 0);
      if (logged <= 0) {
        const mins = Math.max(1, task.estimatedMinutes || 30);
        await this.prisma.timeEntry.create({
          data: {
            taskId,
            startedAt: new Date(now.getTime() - mins * 60_000),
            endedAt: now,
            actualMinutes: mins,
          },
        });
      }
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'completed', inBacklog: false },
      });
      const dateStr = formatDateOnly(task.date);
      if (!task.inBacklog) {
        await this.scheduler.rescheduleDay(userId, dateStr);
      }
      const refreshed = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { timeEntries: true },
      });
      return this.mapTask(refreshed!);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      return this.local.completeTask(userId, taskId);
    }
  }

  async remove(userId: string, taskId: string) {
    const fromDb = await this.viaDb(userId, async (id) => {
      const before = await this.supabase.select<{
        date: string;
        inBacklog?: boolean;
      }>('Task', 'date,inBacklog', {
        filter: `id=eq.${taskId}&userId=eq.${id}`,
        limit: 1,
      });
      await this.supabase.deleteTask(id, taskId);
      if (before[0]?.date && !before[0].inBacklog) {
        await this.scheduler.rescheduleDayPreferRest(
          id,
          String(before[0].date).slice(0, 10),
        );
      }
      return { ok: true as const };
    });
    if (fromDb) return fromDb;

    if (userId.startsWith('local_')) {
      return this.local.removeTask(userId, taskId);
    }
    try {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
      });
      if (!task) throw new NotFoundException();
      const dateStr = formatDateOnly(task.date);
      const wasBacklog = task.inBacklog;
      await this.prisma.task.delete({ where: { id: taskId } });
      if (!wasBacklog) {
        await this.scheduler.rescheduleDay(userId, dateStr);
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      return this.local.removeTask(userId, taskId);
    }
  }

  async update(
    userId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    const hasField =
      dto.notes !== undefined ||
      dto.name !== undefined ||
      dto.estimatedMinutes !== undefined ||
      dto.startTime !== undefined ||
      dto.endTime !== undefined ||
      dto.unlockSchedule !== undefined ||
      dto.inBacklog !== undefined ||
      dto.date !== undefined ||
      dto.order !== undefined;
    if (!hasField) {
      throw new BadRequestException('Nothing to update');
    }

    let tzUserId = userId;
    if (this.db.useDb()) {
      try {
        tzUserId = await this.db.resolveUserId(userId);
      } catch {
        /* keep */
      }
    }
    const tz = await this.resolveTimeZone(tzUserId);

    const fromDb = await this.viaDb(userId, async (id) => {
      const updated = await this.supabase.updateTask(id, taskId, dto, tz);
      if (!updated.inBacklog) {
        await this.scheduler.rescheduleDayPreferRest(id, updated.date);
      }
      const list = await this.supabase.listTasks(id, updated.date);
      const backlog = await this.supabase.listBacklogTasks(id);
      return (
        list.find((t) => t.id === taskId) ??
        backlog.find((t) => t.id === taskId) ??
        updated
      );
    });
    if (fromDb) return fromDb as TaskDto;

    if (userId.startsWith('local_')) {
      return this.local.updateTask(userId, taskId, dto, tz);
    }
    try {
      const existing = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
      });
      if (!existing) throw new NotFoundException('Task not found');

      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('Task name is required');
        data.name = name;
      }
      if (dto.notes !== undefined) {
        data.notes =
          dto.notes == null ? null : String(dto.notes).trim() || null;
      }
      if (dto.estimatedMinutes !== undefined) {
        const n = Number(dto.estimatedMinutes);
        if (!Number.isFinite(n) || n < 5) {
          throw new BadRequestException('Estimated minutes must be at least 5');
        }
        data.estimatedMinutes = Math.round(n);
      }
      if (dto.order !== undefined) {
        data.order = Math.max(0, Math.round(Number(dto.order)));
      }
      if (dto.date !== undefined) {
        data.date = dateOnly(dto.date);
      }
      if (dto.inBacklog === true) {
        data.inBacklog = true;
        data.scheduledStart = null;
        data.scheduledEnd = null;
        data.scheduleLocked = false;
      } else if (dto.inBacklog === false) {
        data.inBacklog = false;
      }
      if (dto.unlockSchedule) {
        data.scheduleLocked = false;
        data.scheduledStart = null;
        data.scheduledEnd = null;
      }
      const startTime =
        dto.startTime === null ? null : dto.startTime?.trim() || undefined;
      const endTime =
        dto.endTime === null ? null : dto.endTime?.trim() || undefined;
      if (startTime || endTime) {
        if (!startTime || !endTime) {
          throw new BadRequestException('Both start and end time are required');
        }
        const startMin = parseHm(startTime);
        const endMin = parseHm(endTime);
        if (!(endMin > startMin)) {
          throw new BadRequestException('End time must be after start time');
        }
        const dateStr =
          dto.date ??
          (data.date
            ? formatDateOnly(data.date as Date)
            : formatDateOnly(existing.date));
        data.scheduledStart = combineDateAndMinutes(dateStr, startMin, tz);
        data.scheduledEnd = combineDateAndMinutes(dateStr, endMin, tz);
        data.scheduleLocked = true;
        data.estimatedMinutes = endMin - startMin;
        data.inBacklog = false;
      }

      const prevDate = formatDateOnly(existing.date);
      await this.prisma.task.update({
        where: { id: taskId },
        data,
      });
      const refreshed = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { timeEntries: true },
      });
      const next = this.mapTask(refreshed!);
      if (!next.inBacklog) {
        await this.scheduler.rescheduleDay(userId, next.date);
      }
      if (prevDate !== next.date && !existing.inBacklog) {
        await this.scheduler.rescheduleDay(userId, prevDate);
      }
      return next;
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      return this.local.updateTask(userId, taskId, dto, tz);
    }
  }

  private mapTask(t: {
    id: string;
    date: Date;
    name: string;
    estimatedMinutes: number;
    status: string;
    order: number;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    notes?: string | null;
    meetLink?: string | null;
    scheduleLocked?: boolean;
    sourceProvider?: string | null;
    sourceExternalId?: string | null;
    inBacklog?: boolean;
    timeEntries: Array<{
      id: string;
      startedAt: Date;
      endedAt: Date | null;
      actualMinutes: number | null;
    }>;
  }): TaskDto {
    const actualMinutes = t.timeEntries.reduce(
      (sum, e) => sum + (e.actualMinutes ?? 0),
      0,
    );
    const active = t.timeEntries.find((e) => !e.endedAt);
    return {
      id: t.id,
      date: formatDateOnly(t.date),
      name: t.name,
      estimatedMinutes: t.estimatedMinutes,
      status: t.status as TaskDto['status'],
      order: t.order,
      scheduledStart: t.scheduledStart?.toISOString() ?? null,
      scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
      actualMinutes,
      activeEntryId: active?.id ?? null,
      notes: t.notes ?? null,
      meetLink: t.meetLink ?? null,
      scheduleLocked: Boolean(t.scheduleLocked),
      sourceProvider: t.sourceProvider ?? null,
      sourceExternalId: t.sourceExternalId ?? null,
      inBacklog: Boolean(t.inBacklog),
    };
  }
}
