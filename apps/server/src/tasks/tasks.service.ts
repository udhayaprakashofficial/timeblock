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
  eventToMinutesOnDay,
  formatDateOnly,
  normalizeTimeZone,
  parseHm,
  todayInTimeZone,
  yesterdayInTimeZone,
} from '../common/time.util';
import { rangesOverlap } from '../common/time.util';

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
        scheduleLocked: false,
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

  /** Move unfinished non-meeting tasks from *yesterday* into the backlog. */
  async carryOverUnfinished(userId: string): Promise<number> {
    const tz = await this.resolveTimeZone(userId);
    const yesterday = yesterdayInTimeZone(tz);

    const fromDb = await this.viaDb(userId, async (id) => {
      await this.supabase.pruneStaleBacklog(id, yesterday);
      await this.supabase.clearOnboardingSampleBacklog(id);
      return this.supabase.carryOverUnfinished(id, yesterday);
    });
    if (fromDb != null) return fromDb;

    if (userId.startsWith('local_')) {
      this.local.pruneStaleBacklog(userId, yesterday);
      this.local.clearOnboardingSampleBacklog(userId);
      return this.local.carryOverUnfinished(userId, yesterday);
    }
    try {
      await this.prisma.task.updateMany({
        where: {
          userId,
          inBacklog: true,
          date: { lt: dateOnly(yesterday) },
        },
        data: { inBacklog: false },
      });
      // Demo samples must never sit in backlog
      const samples = await this.prisma.task.findMany({
        where: {
          userId,
          inBacklog: true,
          status: { in: ['pending', 'in_progress'] },
        },
      });
      for (const t of samples) {
        if (
          TasksService.ONBOARD_SAMPLE_NAMES.has(t.name.trim().toLowerCase())
        ) {
          await this.prisma.task.update({
            where: { id: t.id },
            data: { inBacklog: false, scheduledStart: null, scheduledEnd: null },
          });
        }
      }
      const unfinished = await this.prisma.task.findMany({
        where: {
          userId,
          inBacklog: false,
          scheduleLocked: false,
          status: { in: ['pending', 'in_progress'] },
          date: dateOnly(yesterday),
        },
      });
      let count = 0;
      for (const t of unfinished) {
        if (
          TasksService.ONBOARD_SAMPLE_NAMES.has(t.name.trim().toLowerCase())
        ) {
          continue;
        }
        await this.prisma.task.update({
          where: { id: t.id },
          data: {
            inBacklog: true,
            scheduledStart: null,
            scheduledEnd: null,
          },
        });
        count += 1;
      }
      return count;
    } catch {
      this.local.pruneStaleBacklog(userId, yesterday);
      this.local.clearOnboardingSampleBacklog(userId);
      return this.local.carryOverUnfinished(userId, yesterday);
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

    const yesterday = yesterdayInTimeZone(tz);

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

  /** Names seeded by onboarding — keep dashboard plan aligned with the preview. */
  private static readonly ONBOARD_SAMPLE_NAMES = new Set([
    'plan the day',
    'reply to emails',
    'finish project report',
    'deep work session',
  ]);

  private static onboardAlignDone = new Set<string>();

  /**
   * After onboarding, the preview packs from work start. A later “from now”
   * reschedule used to drop morning slots and shove leftovers to backlog.
   * Pull samples back onto today and re-pack once from work start.
   */
  private async alignOnboardingPlanWithPreview(
    userId: string,
    dateStr: string,
  ): Promise<void> {
    const tz = await this.resolveTimeZone(userId);
    const today = todayInTimeZone(tz);
    if (dateStr !== today) return;

    const key = `${userId}:${today}`;
    if (TasksService.onboardAlignDone.has(key)) return;

    const isSample = (name: string) =>
      TasksService.ONBOARD_SAMPLE_NAMES.has(name.trim().toLowerCase());

    let changed = false;

    const fromDb = await this.viaDb(userId, async (id) => {
      let did = false;
      const backlog = await this.supabase.listBacklogTasks(id);
      for (const t of backlog) {
        if (
          t.date === today &&
          isSample(t.name) &&
          t.status !== 'completed' &&
          !t.scheduleLocked
        ) {
          await this.supabase.scheduleFromBacklog(id, t.id, today);
          did = true;
        }
      }

      const planned = await this.supabase.listTasks(id, today);
      const have = new Set(
        planned.map((t) => t.name.trim().toLowerCase()),
      );
      const templates = await this.supabase.listRecurringTemplates(id);
      for (const t of templates) {
        const n = t.name.trim().toLowerCase();
        if (!isSample(t.name) || !t.active || have.has(n)) continue;
        await this.supabase.createTask(id, {
          date: today,
          name: t.name,
          estimatedMinutes: t.estimatedMinutes,
          inBacklog: false,
        });
        have.add(n);
        did = true;
      }

      const after = await this.supabase.listTasks(id, today);
      const samples = after.filter(
        (t) => isSample(t.name) && !t.inBacklog && t.status !== 'completed',
      );
      if (samples.length < 2) return did;

      const nowMin = (() => {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        }).formatToParts(new Date());
        const map: Record<string, string> = {};
        for (const p of parts) {
          if (p.type !== 'literal') map[p.type] = p.value;
        }
        return Number(map.hour) * 60 + Number(map.minute);
      })();

      const allAfterNow = samples.every((t) => {
        if (!t.scheduledStart) return true;
        const d = new Date(t.scheduledStart);
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        }).formatToParts(d);
        const map: Record<string, string> = {};
        for (const p of parts) {
          if (p.type !== 'literal') map[p.type] = p.value;
        }
        return Number(map.hour) * 60 + Number(map.minute) >= nowMin - 5;
      });

      // Preview packs from ~09:00 — if every sample sits after “now”, realign once.
      if (did || allAfterNow) {
        await this.scheduler.rescheduleDayPreferRest(id, today, {
          ignorePackingFloor: true,
          repackUnlocked: true,
        });
        did = true;
      }
      return did;
    });

    if (fromDb != null) {
      if (fromDb) TasksService.onboardAlignDone.add(key);
      return;
    }

    const backlog = this.local.listBacklog(userId);
    for (const t of backlog) {
      if (
        t.date === today &&
        isSample(t.name) &&
        t.status !== 'completed' &&
        !t.scheduleLocked
      ) {
        this.local.scheduleFromBacklog(userId, t.id, today);
        changed = true;
      }
    }
    const planned = this.local.listTasks(userId, today);
    const have = new Set(planned.map((t) => t.name.trim().toLowerCase()));
    for (const t of this.local.listRecurring(userId)) {
      const n = t.name.trim().toLowerCase();
      if (!isSample(t.name) || !t.active || have.has(n)) continue;
      this.local.createTask(
        userId,
        {
          date: today,
          name: t.name,
          estimatedMinutes: t.estimatedMinutes,
        },
        { skipReschedule: true },
      );
      have.add(n);
      changed = true;
    }
    const samples = this.local
      .listTasks(userId, today)
      .filter((t) => isSample(t.name) && t.status !== 'completed');
    if (samples.length >= 2) {
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const allAfterNow = samples.every((t) => {
        if (!t.scheduledStart) return true;
        const d = new Date(t.scheduledStart);
        return d.getHours() * 60 + d.getMinutes() >= nowMin - 5;
      });
      if (changed || allAfterNow) {
        this.local.rescheduleDayPublic(userId, today, {
          ignorePackingFloor: true,
          repackUnlocked: true,
        });
        changed = true;
      }
    }

    if (changed) TasksService.onboardAlignDone.add(key);
  }

  async list(userId: string, dateStr: string): Promise<TaskDto[]> {
    await this.carryOverUnfinished(userId);
    await this.placeBacklogOnEmptyToday(userId, dateStr);
    await this.materializeRecurring(userId, dateStr);
    await this.alignOnboardingPlanWithPreview(userId, dateStr);

    const fromDb = await this.viaDb(userId, async (id) => {
      let tasks = (await this.supabase.listTasks(
        id,
        dateStr,
      )) as TaskDto[];
      if (this.hasUnlockedOverlap(tasks)) {
        await this.scheduler.rescheduleDayPreferRest(id, dateStr, {
          repackUnlocked: true,
        });
        tasks = (await this.supabase.listTasks(id, dateStr)) as TaskDto[];
      }
      return tasks;
    });
    if (fromDb) return fromDb.filter((t) => !t.inBacklog);

    if (userId.startsWith('local_')) {
      const tasks = this.local.listTasks(userId, dateStr);
      if (this.hasUnlockedOverlap(tasks)) {
        this.local.reorderTasks(
          userId,
          dateStr,
          tasks.map((t) => t.id),
        );
        return this.local.listTasks(userId, dateStr);
      }
      return tasks;
    }
    try {
      const day = dateOnly(dateStr);
      let tasks = await this.prisma.task.findMany({
        where: { userId, date: day, inBacklog: false },
        include: { timeEntries: true },
        orderBy: { order: 'asc' },
      });
      const mapped = tasks.map((t) => this.mapTask(t));
      if (this.hasUnlockedOverlap(mapped)) {
        await this.scheduler.rescheduleDay(userId, dateStr, {
          repackUnlocked: true,
        });
        tasks = await this.prisma.task.findMany({
          where: { userId, date: day, inBacklog: false },
          include: { timeEntries: true },
          orderBy: { order: 'asc' },
        });
        return tasks.map((t) => this.mapTask(t));
      }
      return mapped;
    } catch {
      return this.local.listTasks(userId, dateStr);
    }
  }

  /** True when any two unlocked, scheduled tasks share wall-clock time. */
  private hasUnlockedOverlap(tasks: TaskDto[]): boolean {
    const placed = tasks
      .filter(
        (t) =>
          !t.inBacklog &&
          !t.scheduleLocked &&
          t.status !== 'completed' &&
          t.scheduledStart &&
          t.scheduledEnd,
      )
      .map((t) => ({
        start: new Date(t.scheduledStart!).getTime(),
        end: new Date(t.scheduledEnd!).getTime(),
      }))
      .filter((t) => t.end > t.start);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (
          placed[i].start < placed[j].end &&
          placed[i].end > placed[j].start
        ) {
          return true;
        }
      }
    }
    return false;
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
          // Onboarding seeds the same names without a recurring source id —
          // don't create a duplicate for today.
          if (
            before.some(
              (x) =>
                x.name.trim().toLowerCase() === t.name.trim().toLowerCase(),
            )
          ) {
            continue;
          }
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
        await this.scheduler.rescheduleDayPreferRest(id, dateStr, {
          ignorePackingFloor: true,
          repackUnlocked: true,
        });
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
        const sameName = await this.prisma.task.findFirst({
          where: {
            userId,
            date: dateOnly(dateStr),
            name: { equals: t.name, mode: 'insensitive' },
            inBacklog: false,
          },
        });
        if (sameName) continue;
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
      if (created) {
        await this.scheduler.rescheduleDay(userId, dateStr, {
          ignorePackingFloor: true,
          repackUnlocked: true,
        });
      }
      return created;
    } catch {
      return this.local.materializeRecurring(userId, dateStr);
    }
  }

  async listBacklog(userId: string): Promise<TaskDto[]> {
    await this.carryOverUnfinished(userId);
    const tz = await this.resolveTimeZone(userId);
    const today = todayInTimeZone(tz);
    const yesterday = yesterdayInTimeZone(tz);

    const filterVisible = (rows: TaskDto[]): TaskDto[] => {
      // Yesterday carry-over + anything parked on today (manual / overflow).
      // Never surface older junk or onboarding demo samples.
      const visible = rows.filter((t) => {
        if (t.date !== yesterday && t.date !== today) return false;
        if (
          TasksService.ONBOARD_SAMPLE_NAMES.has(t.name.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      });
      // Dedupe identical names on the same day (double-seed / recurring races).
      const seen = new Set<string>();
      const out: TaskDto[] = [];
      for (const t of visible) {
        const key = `${t.date}:${t.name.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
      }
      return out;
    };

    const fromDb = await this.viaDb(userId, (id) =>
      this.supabase.listBacklogTasks(id),
    );
    if (fromDb) return filterVisible(fromDb);

    if (userId.startsWith('local_')) {
      return filterVisible(this.local.listBacklog(userId));
    }
    try {
      const tasks = await this.prisma.task.findMany({
        where: {
          userId,
          inBacklog: true,
          status: { in: ['pending', 'in_progress'] },
          date: { in: [dateOnly(yesterday), dateOnly(today)] },
        },
        include: { timeEntries: true },
        orderBy: [{ date: 'asc' }, { order: 'asc' }],
      });
      return filterVisible(tasks.map((t) => this.mapTask(t)));
    } catch {
      return filterVisible(this.local.listBacklog(userId));
    }
  }

  /**
   * Fast onboarding seed: create today's tasks once, pack from work-day
   * start (not “now”) so sample tasks land on the plan for first-time users.
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
    const seedNames = new Set(cleaned.map((p) => p.name.toLowerCase()));

    const fromDb = await this.viaDb(userId, async (id) => {
      const existing = await this.supabase.listTasks(id, today);
      const existingNames = new Set(
        existing.map((t) => t.name.trim().toLowerCase()),
      );
      // Sequential creates so order stays stable; skip per-task reschedule.
      // Idempotent: don't double-seed if finish-onboarding retried.
      for (const p of cleaned) {
        if (existingNames.has(p.name.toLowerCase())) continue;
        await this.supabase.createTask(id, {
          date: today,
          name: p.name,
          estimatedMinutes: p.estimatedMinutes,
          inBacklog: false,
        });
        existingNames.add(p.name.toLowerCase());
      }
      // Pack across the full workday so onboarding demos are visible on The plan.
      await this.scheduler.rescheduleDayPreferRest(id, today, {
        repackUnlocked: true,
        ignorePackingFloor: true,
      });

      // Never leave onboarding samples in backlog — keep them on today's queue/plan.
      const backlog = await this.supabase.listBacklogTasks(id);
      const stranded = backlog.filter(
        (t) =>
          t.date === today &&
          seedNames.has(t.name.trim().toLowerCase()) &&
          t.status !== 'completed',
      );
      for (const t of stranded) {
        await this.supabase.scheduleFromBacklog(id, t.id, today);
      }
      if (stranded.length) {
        await this.scheduler.rescheduleDayPreferRest(id, today, {
          repackUnlocked: true,
          ignorePackingFloor: true,
        });
      }
      // If packing still shoved them out, force onto today (queue) without backlog.
      const stillBacklog = (await this.supabase.listBacklogTasks(id)).filter(
        (t) =>
          t.date === today &&
          seedNames.has(t.name.trim().toLowerCase()) &&
          t.status !== 'completed',
      );
      for (const t of stillBacklog) {
        await this.supabase.updateTask(
          id,
          t.id,
          { inBacklog: false, date: today },
          'UTC',
        );
      }

      // Recurring templates — only when user opted in; fire in parallel
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

    // Local / offline path — batch create, then one full-day pack
    const existingLocal = this.local.listTasks(userId, today);
    const existingLocalNames = new Set(
      existingLocal.map((t) => t.name.trim().toLowerCase()),
    );
    for (const p of cleaned) {
      if (existingLocalNames.has(p.name.toLowerCase())) continue;
      this.local.createTask(
        userId,
        {
          date: today,
          name: p.name,
          estimatedMinutes: p.estimatedMinutes,
        },
        { skipReschedule: true },
      );
      existingLocalNames.add(p.name.toLowerCase());
      if (p.recurring && days.length) {
        this.local.createRecurring(userId, {
          name: p.name,
          estimatedMinutes: p.estimatedMinutes,
          weekdays: days,
          active: true,
        });
      }
    }
    this.local.rescheduleDayPublic(userId, today, {
      repackUnlocked: true,
      ignorePackingFloor: true,
    });
    const strandedLocal = this.local
      .listBacklog(userId)
      .filter(
        (t) =>
          t.date === today &&
          seedNames.has(t.name.trim().toLowerCase()) &&
          t.status !== 'completed',
      );
    for (const t of strandedLocal) {
      this.local.scheduleFromBacklog(userId, t.id, today);
    }
    if (strandedLocal.length) {
      this.local.rescheduleDayPublic(userId, today, {
        repackUnlocked: true,
        ignorePackingFloor: true,
      });
    }
    // Force any remaining onboard samples onto today — never leave in backlog.
    for (const t of this.local.listBacklog(userId)) {
      if (
        t.date === today &&
        seedNames.has(t.name.trim().toLowerCase()) &&
        t.status !== 'completed'
      ) {
        this.local.updateTask(userId, t.id, { inBacklog: false });
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
      if (dto.overflowMode === 'reprioritize') {
        const list = await this.supabase.listTasks(id, payload.date);
        const ids = [
          created.id,
          ...list.filter((t) => t.id !== created.id).map((t) => t.id),
        ];
        for (let i = 0; i < ids.length; i++) {
          await this.supabase.patch(
            'Task',
            `id=eq.${ids[i]}&userId=eq.${id}`,
            { order: i, updatedAt: new Date().toISOString() },
          );
        }
        await this.scheduler.rescheduleDayPreferRest(id, payload.date, {
          repackUnlocked: true,
          ignorePackingFloor: true,
        });
      } else if (dto.overflowMode === 'overtime') {
        await this.scheduler.rescheduleDayPreferRest(id, payload.date, {
          allowOvertime: true,
          overtimeMinutes: payload.estimatedMinutes + 60,
          ignorePackingFloor: true,
          repackUnlocked: true,
        });
      } else {
        await this.scheduler.rescheduleDayPreferRest(id, payload.date);
      }
      const dayList = await this.supabase.listTasks(id, payload.date);
      const backlog = await this.supabase.listBacklogTasks(id);
      return (
        dayList.find((t) => t.id === created.id) ??
        backlog.find((t) => t.id === created.id) ??
        dayList.find((t) => t.name === payload.name && t.date === payload.date) ??
        created
      );
    });
    if (fromDb) return fromDb as TaskDto;

    if (userId.startsWith('local_')) {
      return this.local.createTask(userId, {
        ...payload,
        overflowMode: dto.overflowMode,
      });
    }
    try {
      const day = dateOnly(payload.date);
      const peers = await this.prisma.task.findMany({
        where: { userId, date: day, inBacklog: false },
        orderBy: { order: 'asc' },
      });
      const order =
        dto.overflowMode === 'reprioritize'
          ? 0
          : peers.reduce((max, t) => Math.max(max, t.order), -1) + 1;
      if (dto.overflowMode === 'reprioritize') {
        for (let i = 0; i < peers.length; i++) {
          await this.prisma.task.update({
            where: { id: peers[i]!.id },
            data: { order: i + 1 },
          });
        }
      }
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
      if (dto.overflowMode === 'overtime') {
        await this.scheduler.rescheduleDay(userId, payload.date, {
          allowOvertime: true,
          overtimeMinutes: payload.estimatedMinutes + 60,
          ignorePackingFloor: true,
          repackUnlocked: true,
        });
      } else if (dto.overflowMode === 'reprioritize') {
        await this.scheduler.rescheduleDay(userId, payload.date, {
          repackUnlocked: true,
          ignorePackingFloor: true,
        });
      } else {
        await this.scheduler.rescheduleDay(userId, payload.date);
      }
      const refreshed = await this.prisma.task.findUnique({
        where: { id: task.id },
        include: { timeEntries: true },
      });
      return this.mapTask(refreshed!);
    } catch {
      return this.local.createTask(userId, {
        ...payload,
        overflowMode: dto.overflowMode,
      });
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
      await this.supabase.scheduleFromBacklog(id, taskId, dateStr);
      // Prefer next free slot after now; if that still can't fit, pack the
      // full workday so Schedule never silently bounces back to backlog.
      await this.scheduler.rescheduleDayPreferRest(id, dateStr);
      let list = await this.supabase.listTasks(id, dateStr);
      let placed: TaskDto | null | undefined = list.find((t) => t.id === taskId);
      if (!placed) {
        await this.supabase.scheduleFromBacklog(id, taskId, dateStr);
        await this.scheduler.rescheduleDayPreferRest(id, dateStr, {
          ignorePackingFloor: true,
        });
        list = await this.supabase.listTasks(id, dateStr);
        placed = list.find((t) => t.id === taskId);
      }
      if (!placed) {
        // Last resort: pin after the latest block / now so the task stays on plan.
        placed = await this.forcePlaceOnDay(id, taskId, dateStr, tz);
      }
      const backlog = await this.supabase.listBacklogTasks(id);
      return (
        placed ??
        backlog.find((t) => t.id === taskId) ??
        (await this.supabase.listTasks(id, dateStr)).find((t) => t.id === taskId)
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
      let refreshed = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { timeEntries: true },
      });
      if (refreshed?.inBacklog) {
        await this.prisma.task.update({
          where: { id: taskId },
          data: { inBacklog: false, scheduledStart: null, scheduledEnd: null },
        });
        await this.scheduler.rescheduleDay(userId, dateStr, {
          ignorePackingFloor: true,
        });
        refreshed = await this.prisma.task.findUnique({
          where: { id: taskId },
          include: { timeEntries: true },
        });
      }
      return this.mapTask(refreshed!);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        throw err;
      }
      return this.local.scheduleFromBacklog(userId, taskId, dateStr);
    }
  }

  /** Pin a task onto the day after the latest block (or now) so Schedule always sticks. */
  private async forcePlaceOnDay(
    userId: string,
    taskId: string,
    dateStr: string,
    timeZone: string,
  ): Promise<TaskDto | null> {
    const list = await this.supabase.listTasks(userId, dateStr);
    const target = list.find((t) => t.id === taskId);
    const fromBacklog = target
      ? null
      : (await this.supabase.listBacklogTasks(userId)).find((t) => t.id === taskId);
    const task = target ?? fromBacklog;
    if (!task) return null;

    if (fromBacklog) {
      await this.supabase.scheduleFromBacklog(userId, taskId, dateStr);
    }

    const floor =
      dateStr === todayInTimeZone(timeZone)
        ? (() => {
            const parts = new Intl.DateTimeFormat('en-US', {
              timeZone,
              hourCycle: 'h23',
              hour: '2-digit',
              minute: '2-digit',
            }).formatToParts(new Date());
            const map: Record<string, string> = {};
            for (const p of parts) {
              if (p.type !== 'literal') map[p.type] = p.value;
            }
            return Number(map.hour) * 60 + Number(map.minute);
          })()
        : 9 * 60;

    let cursor = floor;
    for (const t of list) {
      if (t.id === taskId || !t.scheduledStart || !t.scheduledEnd) continue;
      if (t.status === 'completed') continue;
      const end = eventToMinutesOnDay(
        dateStr,
        new Date(t.scheduledStart),
        new Date(t.scheduledEnd),
        timeZone,
      );
      if (end) cursor = Math.max(cursor, end.end);
    }
    const need = Math.max(5, Math.round(Number(task.estimatedMinutes) || 30));
    const start = Math.min(cursor, 24 * 60 - need);
    const end = start + need;
    const scheduledStart = combineDateAndMinutes(dateStr, start, timeZone);
    const scheduledEnd = combineDateAndMinutes(dateStr, end, timeZone);
    await this.supabase.patch('Task', `id=eq.${taskId}`, {
      inBacklog: false,
      scheduledStart: scheduledStart.toISOString(),
      scheduledEnd: scheduledEnd.toISOString(),
      scheduleLocked: false,
      updatedAt: new Date().toISOString(),
    });
    const refreshed = await this.supabase.listTasks(userId, dateStr);
    return refreshed.find((t) => t.id === taskId) ?? null;
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
      await this.scheduler.rescheduleDayPreferRest(id, dateStr, {
        repackUnlocked: true,
        ignorePackingFloor: true,
        allowOvertime: true,
      });
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
      await this.scheduler.rescheduleDay(userId, dateStr, {
        repackUnlocked: true,
        ignorePackingFloor: true,
        allowOvertime: true,
      });
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

      // Toggle: completed → reopen as pending
      if (task.status === 'completed') {
        const entries = await this.prisma.timeEntry.findMany({
          where: { taskId },
        });
        const est = Math.max(1, task.estimatedMinutes || 30);
        // Strip Done-without-timer credit so actual returns to timer-only.
        if (
          entries.length === 1 &&
          entries[0]!.endedAt &&
          (entries[0]!.actualMinutes ?? 0) === est
        ) {
          await this.prisma.timeEntry.delete({ where: { id: entries[0]!.id } });
        }
        await this.prisma.task.update({
          where: { id: taskId },
          data: { status: 'pending' },
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
      }

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
        if (Math.round(n) !== existing.estimatedMinutes) {
          data.scheduledStart = null;
          data.scheduledEnd = null;
          if (!existing.scheduleLocked) data.scheduleLocked = false;
        }
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
        const siblings = await this.prisma.task.findMany({
          where: {
            userId,
            date: dateOnly(dateStr),
            inBacklog: false,
            id: { not: taskId },
            status: { not: 'completed' },
          },
        });
        for (const sib of siblings) {
          if (!sib.scheduledStart || !sib.scheduledEnd) continue;
          const other = eventToMinutesOnDay(
            dateStr,
            sib.scheduledStart,
            sib.scheduledEnd,
            tz,
          );
          if (!other) continue;
          if (rangesOverlap(startMin, endMin, other.start, other.end)) {
            throw new BadRequestException(
              'That time overlaps another task. Pick a free slot that fits the full duration.',
            );
          }
        }
        data.scheduledStart = combineDateAndMinutes(dateStr, startMin, tz);
        data.scheduledEnd = combineDateAndMinutes(dateStr, endMin, tz);
        if (!existing.sourceProvider && !existing.meetLink) {
          data.scheduleLocked = false;
        }
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
    const displayActual =
      t.status === 'completed' && actualMinutes <= 0
        ? Math.max(1, t.estimatedMinutes || 30)
        : actualMinutes;
    return {
      id: t.id,
      date: formatDateOnly(t.date),
      name: t.name,
      estimatedMinutes: t.estimatedMinutes,
      status: t.status as TaskDto['status'],
      order: t.order,
      scheduledStart: t.scheduledStart?.toISOString() ?? null,
      scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
      actualMinutes: displayActual,
      activeEntryId: active?.id ?? null,
      timerStartedAt: active?.startedAt?.toISOString() ?? null,
      notes: t.notes ?? null,
      meetLink: t.meetLink ?? null,
      scheduleLocked: Boolean(t.scheduleLocked),
      sourceProvider: t.sourceProvider ?? null,
      sourceExternalId: t.sourceExternalId ?? null,
      inBacklog: Boolean(t.inBacklog),
    };
  }
}
