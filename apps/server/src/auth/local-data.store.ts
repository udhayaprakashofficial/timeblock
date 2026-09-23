import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import type {
  CreateTaskDto,
  DailyScheduleTemplateDto,
  RecurringTaskDto,
  StatsOverviewDto,
  TaskDto,
  UpsertScheduleTemplateDto,
  Weekday,
  WeeklyReportDto,
} from '@timeblock/shared-types';
import {
  addDays,
  combineDateAndMinutes,
  dateOnly,
  formatDateOnly,
  parseHm,
  startOfWeek,
  subtractIntervals,
  type Interval,
} from '../common/time.util';
import { buildEffortSummary } from '../stats/effort-badges';

type LocalTask = {
  id: string;
  userId: string;
  date: string;
  name: string;
  estimatedMinutes: number;
  status: 'pending' | 'in_progress' | 'completed';
  order: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualMinutes: number;
  activeEntryId: string | null;
  timerStartedAt?: string | null;
  scheduleLocked?: boolean;
  meetLink?: string | null;
  sourceProvider?: string | null;
  sourceExternalId?: string | null;
  notes?: string | null;
  inBacklog?: boolean;
};

type LocalBreak = { id: string; name: string; start: string; end: string };

type LocalTemplate = {
  id: string;
  userId: string;
  weekday: Weekday;
  workStart: string;
  workEnd: string;
  breaks: LocalBreak[];
};

type LocalRecurring = {
  id: string;
  userId: string;
  name: string;
  estimatedMinutes: number;
  weekdays: Weekday[];
  active: boolean;
};

type StoreFile = {
  tasks: LocalTask[];
  schedules: LocalTemplate[];
  recurring?: LocalRecurring[];
};

function localDataDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return resolve(tmpdir(), 'cupkey-data');
  }
  return resolve(__dirname, '../../data');
}

@Injectable()
export class LocalDataStore {
  private readonly dir = localDataDir();
  private readonly file = resolve(this.dir, 'local-app.json');

  private read(): StoreFile {
    if (!existsSync(this.file)) return { tasks: [], schedules: [], recurring: [] };
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      return {
        tasks: raw.tasks ?? [],
        schedules: raw.schedules ?? [],
        recurring: raw.recurring ?? [],
      };
    } catch {
      return { tasks: [], schedules: [], recurring: [] };
    }
  }

  private write(data: StoreFile) {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      /* Vercel / read-only FS — keep in-memory only for this request */
    }
  }

  private defaultTemplates(userId: string): LocalTemplate[] {
    const weekdays: Weekday[] = [1, 2, 3, 4, 5];
    return weekdays.map((weekday) => ({
      id: `ltpl_${randomBytes(6).toString('hex')}`,
      userId,
      weekday,
      workStart: '09:00',
      workEnd: '18:00',
      breaks: [
        {
          id: `lbr_${randomBytes(4).toString('hex')}`,
          name: 'Lunch',
          start: '12:00',
          end: '13:00',
        },
      ],
    }));
  }

  ensureDefaultSchedule(userId: string) {
    const db = this.read();
    const existing = db.schedules.filter((s) => s.userId === userId);
    if (existing.length) return;
    db.schedules.push(...this.defaultTemplates(userId));
    this.write(db);
  }

  listSchedule(userId: string): DailyScheduleTemplateDto[] {
    this.ensureDefaultSchedule(userId);
    const rows = this.read()
      .schedules.filter((s) => s.userId === userId)
      .sort((a, b) => a.weekday - b.weekday);
    const source = rows.length ? rows : this.defaultTemplates(userId);
    return source.map((s) => ({
      id: s.id,
      weekday: s.weekday,
      workStart: s.workStart,
      workEnd: s.workEnd,
      breaks: s.breaks.map((b) => ({ ...b })),
    }));
  }

  upsertSchedule(
    userId: string,
    dto: UpsertScheduleTemplateDto,
  ): DailyScheduleTemplateDto {
    const db = this.read();
    let row = db.schedules.find(
      (s) => s.userId === userId && s.weekday === dto.weekday,
    );
    if (!row) {
      row = {
        id: `ltpl_${randomBytes(6).toString('hex')}`,
        userId,
        weekday: dto.weekday,
        workStart: dto.workStart,
        workEnd: dto.workEnd,
        breaks: [],
      };
      db.schedules.push(row);
    }
    row.workStart = dto.workStart;
    row.workEnd = dto.workEnd;
    row.breaks = dto.breaks.map((b) => ({
      id: `lbr_${randomBytes(4).toString('hex')}`,
      name: b.name,
      start: b.start,
      end: b.end,
    }));
    this.write(db);
    this.rescheduleUpcoming(userId);
    return {
      id: row.id,
      weekday: row.weekday,
      workStart: row.workStart,
      workEnd: row.workEnd,
      breaks: row.breaks.map((b) => ({ ...b })),
    };
  }

  applyScheduleToAll(
    userId: string,
    dto: Omit<UpsertScheduleTemplateDto, 'weekday'>,
  ): DailyScheduleTemplateDto[] {
    for (const weekday of [0, 1, 2, 3, 4, 5, 6] as Weekday[]) {
      this.upsertSchedule(userId, { ...dto, weekday });
    }
    return this.listSchedule(userId);
  }

  listTasks(userId: string, dateStr: string): TaskDto[] {
    this.ensureDefaultSchedule(userId);
    const db = this.read();
    let dirty = false;
    for (const t of db.tasks) {
      if (
        t.userId === userId &&
        t.date === dateStr &&
        t.status === 'completed' &&
        t.actualMinutes <= 0
      ) {
        t.actualMinutes = Math.max(1, t.estimatedMinutes || 30);
        dirty = true;
      }
    }
    if (dirty) this.write(db);
    return this.read()
      .tasks.filter(
        (t) =>
          t.userId === userId && t.date === dateStr && !t.inBacklog,
      )
      .sort((a, b) => a.order - b.order)
      .map((t) => this.toDto(t));
  }

  listBacklog(userId: string): TaskDto[] {
    return this.read()
      .tasks.filter(
        (t) =>
          t.userId === userId &&
          t.inBacklog &&
          t.status !== 'completed',
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
      .map((t) => this.toDto(t));
  }

  carryOverUnfinished(userId: string, today: string): number {
    const db = this.read();
    let count = 0;
    for (const t of db.tasks) {
      if (
        t.userId === userId &&
        !t.inBacklog &&
        !t.scheduleLocked &&
        t.status !== 'completed' &&
        t.date < today
      ) {
        t.inBacklog = true;
        t.scheduledStart = null;
        t.scheduledEnd = null;
        count += 1;
      }
    }
    if (count) this.write(db);
    return count;
  }

  /** Move unfinished (incl. backlog) tasks from fromDate onto toDate for packing. */
  moveUnfinishedDayToDate(
    userId: string,
    fromDate: string,
    toDate: string,
  ): number {
    if (!fromDate || !toDate || fromDate === toDate) return 0;
    const db = this.read();
    const dayTasks = db.tasks.filter(
      (x) => x.userId === userId && x.date === toDate && !x.inBacklog,
    );
    let order =
      dayTasks.reduce((max, x) => Math.max(max, x.order), -1) + 1;
    let count = 0;
    for (const t of db.tasks) {
      if (
        t.userId !== userId ||
        t.date !== fromDate ||
        t.scheduleLocked ||
        t.status === 'completed'
      ) {
        continue;
      }
      t.date = toDate;
      t.inBacklog = false;
      t.scheduledStart = null;
      t.scheduledEnd = null;
      t.scheduleLocked = false;
      t.order = order++;
      count += 1;
    }
    if (count) {
      this.write(db);
      this.rescheduleDay(userId, toDate);
    }
    return count;
  }

  scheduleFromBacklog(userId: string, taskId: string, dateStr: string): TaskDto {
    const db = this.read();
    const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
    if (!t) throw new Error('Task not found');
    const dayTasks = db.tasks.filter(
      (x) => x.userId === userId && x.date === dateStr && !x.inBacklog,
    );
    t.date = dateStr;
    t.inBacklog = false;
    t.scheduleLocked = false;
    t.scheduledStart = null;
    t.scheduledEnd = null;
    t.order =
      dayTasks.reduce((max, x) => Math.max(max, x.order), -1) + 1;
    this.write(db);
    this.rescheduleDay(userId, dateStr);
    return this.toDto(this.read().tasks.find((x) => x.id === taskId)!);
  }

  createTask(userId: string, dto: CreateTaskDto & {
    scheduledStart?: Date | string | null;
    scheduledEnd?: Date | string | null;
    scheduleLocked?: boolean;
    sourceProvider?: string | null;
    sourceExternalId?: string | null;
  }): TaskDto {
    this.ensureDefaultSchedule(userId);
    const db = this.read();
    if (dto.sourceProvider && dto.sourceExternalId) {
      const existing = db.tasks.find(
        (t) =>
          t.userId === userId &&
          t.sourceProvider === dto.sourceProvider &&
          t.sourceExternalId === dto.sourceExternalId,
      );
      if (existing) return this.toDto(existing);
    }
    const dayTasks = db.tasks.filter(
      (t) => t.userId === userId && t.date === dto.date && !t.inBacklog,
    );
    const order =
      dayTasks.reduce((max, t) => Math.max(max, t.order), -1) + 1;
    const scheduleLocked = Boolean(dto.scheduleLocked);
    const scheduledStart = dto.scheduledStart
      ? typeof dto.scheduledStart === 'string'
        ? dto.scheduledStart
        : dto.scheduledStart.toISOString()
      : null;
    const scheduledEnd = dto.scheduledEnd
      ? typeof dto.scheduledEnd === 'string'
        ? dto.scheduledEnd
        : dto.scheduledEnd.toISOString()
      : null;
    const task: LocalTask = {
      id: `ltask_${randomBytes(8).toString('hex')}`,
      userId,
      date: dto.date,
      name: dto.name.trim(),
      estimatedMinutes: dto.estimatedMinutes ?? 30,
      status: 'pending',
      order,
      scheduledStart,
      scheduledEnd,
      scheduleLocked,
      sourceProvider: dto.sourceProvider ?? null,
      sourceExternalId: dto.sourceExternalId ?? null,
      notes: null,
      inBacklog: false,
      actualMinutes: 0,
      activeEntryId: null,
    };
    db.tasks.push(task);
    this.write(db);
    this.rescheduleDay(userId, dto.date);
    return this.toDto(
      this.read().tasks.find((t) => t.id === task.id)!,
    );
  }

  listRecurring(userId: string): RecurringTaskDto[] {
    return (this.read().recurring ?? [])
      .filter((r) => r.userId === userId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        estimatedMinutes: r.estimatedMinutes,
        weekdays: r.weekdays,
        active: r.active,
      }));
  }

  createRecurring(
    userId: string,
    input: {
      name: string;
      estimatedMinutes: number;
      weekdays: Weekday[];
      active?: boolean;
    },
  ): RecurringTaskDto {
    const db = this.read();
    if (!db.recurring) db.recurring = [];
    const row: LocalRecurring = {
      id: `lrec_${randomBytes(8).toString('hex')}`,
      userId,
      name: input.name.trim(),
      estimatedMinutes: Math.max(5, Math.min(480, input.estimatedMinutes || 30)),
      weekdays: [...new Set(input.weekdays)].sort() as Weekday[],
      active: input.active !== false,
    };
    db.recurring.push(row);
    this.write(db);
    return {
      id: row.id,
      name: row.name,
      estimatedMinutes: row.estimatedMinutes,
      weekdays: row.weekdays,
      active: row.active,
    };
  }

  deleteRecurring(userId: string, id: string): void {
    const db = this.read();
    db.recurring = (db.recurring ?? []).filter(
      (r) => !(r.id === id && r.userId === userId),
    );
    this.write(db);
  }

  /** Create today's instances for active templates matching the weekday. */
  materializeRecurring(userId: string, dateStr: string): number {
    const day = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(day.getTime())) return 0;
    const weekday = day.getDay() as Weekday;
    const templates = this.listRecurring(userId).filter(
      (t) => t.active && t.weekdays.includes(weekday),
    );
    let created = 0;
    for (const t of templates) {
      const externalId = `${t.id}:${dateStr}`;
      const before = this.read().tasks.find(
        (x) =>
          x.userId === userId &&
          x.sourceProvider === 'recurring' &&
          x.sourceExternalId === externalId,
      );
      if (before) continue;
      this.createTask(userId, {
        date: dateStr,
        name: t.name,
        estimatedMinutes: t.estimatedMinutes,
        sourceProvider: 'recurring',
        sourceExternalId: externalId,
      });
      created += 1;
    }
    return created;
  }

  reorderTasks(userId: string, dateStr: string, taskIds: string[]): TaskDto[] {
    const db = this.read();
    taskIds.forEach((id, index) => {
      const t = db.tasks.find(
        (x) => x.id === id && x.userId === userId && x.date === dateStr,
      );
      if (t) t.order = index;
    });
    this.write(db);
    this.rescheduleDay(userId, dateStr);
    return this.listTasks(userId, dateStr);
  }

  completeTask(userId: string, taskId: string): TaskDto {
    const db = this.read();
    const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
    if (!t) throw new Error('Task not found');
    if (t.activeEntryId && t.timerStartedAt) {
      const started = new Date(t.timerStartedAt).getTime();
      const elapsed = Math.max(1, Math.round((Date.now() - started) / 60000));
      t.actualMinutes += elapsed;
      t.activeEntryId = null;
      t.timerStartedAt = null;
    }
    // Checkbox Done without a timer still counts planned time (proof of work)
    if (t.actualMinutes <= 0) {
      t.actualMinutes = Math.max(1, t.estimatedMinutes || 30);
    }
    t.status = 'completed';
    this.write(db);
    this.rescheduleDay(userId, t.date);
    return this.toDto(this.read().tasks.find((x) => x.id === taskId)!);
  }

  updateTask(
    userId: string,
    taskId: string,
    patch: {
      notes?: string | null;
      name?: string;
      estimatedMinutes?: number;
      startTime?: string | null;
      endTime?: string | null;
      unlockSchedule?: boolean;
      inBacklog?: boolean;
      date?: string;
      order?: number;
    },
    timeZone = 'UTC',
  ): TaskDto {
    const db = this.read();
    const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
    if (!t) throw new Error('Task not found');
    const prevDate = t.date;
    if (patch.notes !== undefined) t.notes = patch.notes;
    if (patch.name !== undefined) t.name = patch.name.trim();
    if (patch.estimatedMinutes !== undefined) {
      t.estimatedMinutes = Math.round(patch.estimatedMinutes);
    }
    if (patch.order !== undefined) t.order = Math.max(0, Math.round(patch.order));
    if (patch.date !== undefined) t.date = patch.date;
    if (patch.inBacklog === true) {
      t.inBacklog = true;
      t.scheduledStart = null;
      t.scheduledEnd = null;
      t.scheduleLocked = false;
    } else if (patch.inBacklog === false) {
      t.inBacklog = false;
    }
    if (patch.unlockSchedule) {
      t.scheduleLocked = false;
      t.scheduledStart = null;
      t.scheduledEnd = null;
    }
    const startTime =
      patch.startTime === null ? null : patch.startTime?.trim() || undefined;
    const endTime =
      patch.endTime === null ? null : patch.endTime?.trim() || undefined;
    if (startTime || endTime) {
      if (!startTime || !endTime) throw new Error('Both start and end required');
      const startMin = parseHm(startTime);
      const endMin = parseHm(endTime);
      if (!(endMin > startMin)) throw new Error('End must be after start');
      t.scheduledStart = combineDateAndMinutes(
        t.date,
        startMin,
        timeZone,
      ).toISOString();
      t.scheduledEnd = combineDateAndMinutes(
        t.date,
        endMin,
        timeZone,
      ).toISOString();
      t.scheduleLocked = true;
      t.estimatedMinutes = endMin - startMin;
      t.inBacklog = false;
    }
    this.write(db);
    if (!t.inBacklog) this.rescheduleDay(userId, t.date);
    if (prevDate !== t.date) this.rescheduleDay(userId, prevDate);
    return this.toDto(this.read().tasks.find((x) => x.id === taskId)!);
  }

  removeTask(userId: string, taskId: string) {
    const db = this.read();
    const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
    if (!t) throw new Error('Task not found');
    const date = t.date;
    db.tasks = db.tasks.filter((x) => x.id !== taskId);
    this.write(db);
    this.rescheduleDay(userId, date);
    return { ok: true };
  }

  startTimer(userId: string, taskId: string): TaskDto {
    const db = this.read();
    const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
    if (!t) throw new Error('Task not found');
    if (t.status === 'completed') throw new Error('Task already completed');
    if (t.activeEntryId) throw new Error('Timer already running for this task');
    // Block timers for future civil days (UTC fallback — local store has no user TZ)
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (t.date > todayUtc) throw new Error('Cannot start a timer on a future day');
    // Stop any other running timers for this user
    for (const other of db.tasks) {
      if (other.userId !== userId || other.id === taskId) continue;
      if (!other.activeEntryId || !other.timerStartedAt) continue;
      const started = new Date(other.timerStartedAt).getTime();
      const elapsed = Math.max(1, Math.round((Date.now() - started) / 60000));
      other.actualMinutes += elapsed;
      other.activeEntryId = null;
      other.timerStartedAt = null;
      if (other.status === 'in_progress') other.status = 'pending';
    }
    t.activeEntryId = `lentry_${randomBytes(6).toString('hex')}`;
    t.timerStartedAt = new Date().toISOString();
    if (t.status === 'pending') t.status = 'in_progress';
    this.write(db);
    return this.toDto(t);
  }

  stopTimer(userId: string, taskId: string): TaskDto {
    const db = this.read();
    const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
    if (!t) throw new Error('Task not found');
    if (!t.activeEntryId || !t.timerStartedAt) {
      throw new Error('No active timer');
    }
    const started = new Date(t.timerStartedAt).getTime();
    const elapsed = Math.max(
      1,
      Math.round((Date.now() - started) / 60000),
    );
    t.actualMinutes += elapsed;
    t.activeEntryId = null;
    t.timerStartedAt = null;
    if (t.status === 'in_progress') t.status = 'pending';
    this.write(db);
    return this.toDto(t);
  }

  overview(userId: string, dateStr: string): StatsOverviewDto {
    this.ensureDefaultSchedule(userId);
    const day = dateOnly(dateStr);
    const weekStart = startOfWeek(day);
    const weekEnd = addDays(weekStart, 6);
    const weekStartStr = formatDateOnly(weekStart);
    const weekEndStr = formatDateOnly(weekEnd);
    const db = this.read();
    const todayTasks = db.tasks.filter(
      (t) => t.userId === userId && t.date === dateStr,
    );
    const weekTasks = db.tasks.filter(
      (t) =>
        t.userId === userId && t.date >= weekStartStr && t.date <= weekEndStr,
    );
    const { availableMinutes } = this.getAvailable(userId, dateStr);
    const scheduledMinutes = todayTasks.reduce(
      (s, t) => s + t.estimatedMinutes,
      0,
    );
    const utilizationPercent =
      availableMinutes === 0
        ? 0
        : Math.round((scheduledMinutes / availableMinutes) * 100);

    const counters = (tasks: LocalTask[]) => ({
      total: tasks.length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      pending: tasks.filter((t) => t.status !== 'completed').length,
    });

    const recentStartStr = formatDateOnly(addDays(day, -13));
    const recentTasks = db.tasks.filter(
      (t) =>
        t.userId === userId &&
        t.date >= recentStartStr &&
        t.date <= weekEndStr,
    );

    return {
      today: counters(todayTasks),
      week: counters(weekTasks),
      utilization: {
        date: dateStr,
        availableMinutes,
        scheduledMinutes,
        utilizationPercent,
        tip: "Don't go over 80% utilization — leave room for ad-hoc tasks.",
      },
      effort: buildEffortSummary({
        date: dateStr,
        todayTasks,
        weekTasks,
        recentTasks,
        utilizationPercent,
      }),
    };
  }

  utilization(userId: string, dateStr: string) {
    return this.overview(userId, dateStr).utilization;
  }

  weeklyReport(userId: string, dateStr: string): WeeklyReportDto {
    this.ensureDefaultSchedule(userId);
    const day = dateOnly(dateStr);
    const weekStart = startOfWeek(day);
    const weekEnd = addDays(weekStart, 6);
    const weekStartStr = formatDateOnly(weekStart);
    const weekEndStr = formatDateOnly(weekEnd);
    const db = this.read();
    const weekTasks = db.tasks.filter(
      (t) =>
        t.userId === userId && t.date >= weekStartStr && t.date <= weekEndStr,
    );

    const byDay = [];
    for (let i = 0; i < 7; i++) {
      const d = formatDateOnly(addDays(weekStart, i));
      const dayTasks = weekTasks.filter((t) => t.date === d);
      const completed = dayTasks.filter((t) => t.status === 'completed').length;
      const total = dayTasks.length;
      byDay.push({
        date: d,
        estimatedMinutes: dayTasks.reduce((s, t) => s + t.estimatedMinutes, 0),
        actualMinutes: dayTasks.reduce((s, t) => s + t.actualMinutes, 0),
        total,
        completed,
        pending: total - completed,
        completionPercent:
          total === 0 ? 0 : Math.round((completed / total) * 100),
      });
    }

    const byTask = weekTasks.map((t) => ({
      taskId: t.id,
      name: t.name,
      date: t.date,
      estimatedMinutes: t.estimatedMinutes,
      actualMinutes: t.actualMinutes,
      status: t.status as 'pending' | 'in_progress' | 'completed',
      varianceMinutes: t.actualMinutes - t.estimatedMinutes,
      scheduleLocked: Boolean(t.scheduleLocked),
      scheduledStart: t.scheduledStart ?? null,
      scheduledEnd: t.scheduledEnd ?? null,
    }));

    const total = weekTasks.length;
    const completed = weekTasks.filter((t) => t.status === 'completed').length;
    const totals = {
      estimatedMinutes: byDay.reduce((s, d) => s + d.estimatedMinutes, 0),
      actualMinutes: byDay.reduce((s, d) => s + d.actualMinutes, 0),
      total,
      completed,
      pending: total - completed,
      completionPercent:
        total === 0 ? 0 : Math.round((completed / total) * 100),
    };

    return {
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      byDay,
      byTask,
      totals,
    };
  }

  eodSheet(userId: string, dateStr: string) {
    const db = this.read();
    const dayTasks = db.tasks.filter(
      (t) => t.userId === userId && t.date === dateStr,
    );
    const rows = dayTasks.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status as 'pending' | 'in_progress' | 'completed',
      estimatedMinutes: t.estimatedMinutes,
      actualMinutes: t.actualMinutes,
      varianceMinutes: t.actualMinutes - t.estimatedMinutes,
      scheduledStart: t.scheduledStart ?? null,
      scheduledEnd: t.scheduledEnd ?? null,
      scheduleLocked: Boolean(t.scheduleLocked),
      meetLink: t.meetLink ?? null,
      notes: t.notes ?? null,
    }));
    const total = rows.length;
    const completed = rows.filter((t) => t.status === 'completed').length;
    const inProgress = rows.filter((t) => t.status === 'in_progress').length;
    return {
      date: dateStr,
      generatedAt: new Date().toISOString(),
      summary: {
        total,
        completed,
        pending: total - completed,
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

  private getAvailable(
    userId: string,
    dateStr: string,
  ): { intervals: Interval[]; availableMinutes: number } {
    const day = dateOnly(dateStr);
    const weekday = day.getUTCDay() as Weekday;
    const template = this.read().schedules.find(
      (s) => s.userId === userId && s.weekday === weekday,
    );
    if (!template) return { intervals: [], availableMinutes: 0 };

    let available: Interval[] = [
      {
        start: parseHm(template.workStart),
        end: parseHm(template.workEnd),
      },
    ];
    available = subtractIntervals(
      available,
      template.breaks.map((b) => ({
        start: parseHm(b.start),
        end: parseHm(b.end),
      })),
    );
    const availableMinutes = available.reduce(
      (sum, i) => sum + (i.end - i.start),
      0,
    );
    return { intervals: available, availableMinutes };
  }

  private rescheduleUpcoming(userId: string) {
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      this.rescheduleDay(userId, formatDateOnly(addDays(today, i)));
    }
  }

  private rescheduleDay(userId: string, dateStr: string) {
    const db = this.read();
    const day = dateOnly(dateStr);
    const { intervals } = this.getAvailable(userId, dateStr);
    const dayTasks = db.tasks
      .filter((t) => t.userId === userId && t.date === dateStr && !t.inBacklog)
      .sort((a, b) => a.order - b.order);

    const completed = dayTasks.filter((t) => t.status === 'completed');
    const locked = dayTasks.filter(
      (t) => t.scheduleLocked && t.status !== 'completed',
    );
    const pending = dayTasks.filter(
      (t) => t.status !== 'completed' && !t.scheduleLocked,
    );

    const busyFixed: Interval[] = [];
    for (const t of [...completed, ...locked]) {
      if (t.scheduledStart && t.scheduledEnd) {
        const s = new Date(t.scheduledStart);
        const e = new Date(t.scheduledEnd);
        busyFixed.push({
          start: s.getUTCHours() * 60 + s.getUTCMinutes(),
          end: e.getUTCHours() * 60 + e.getUTCMinutes(),
        });
      }
    }

    let free = subtractIntervals(intervals, busyFixed);
    // Don't pack unlocked tasks into the past when scheduling today.
    const todayLocal = formatDateOnly(new Date());
    if (dateStr === todayLocal) {
      const now = new Date();
      const floor = now.getHours() * 60 + now.getMinutes();
      const coverageEnd = free.reduce((m, i) => Math.max(m, i.end), 0);
      if (coverageEnd <= floor + 45) {
        const end = Math.min(24 * 60, floor + 4 * 60);
        if (end > floor) free = [...free, { start: floor, end }];
      }
      free = free
        .map((i) => ({ start: Math.max(i.start, floor), end: i.end }))
        .filter((i) => i.end > i.start);
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
      if (placed) {
        task.scheduledStart = combineDateAndMinutes(
          day,
          placed.start,
        ).toISOString();
        task.scheduledEnd = combineDateAndMinutes(day, placed.end).toISOString();
      } else {
        task.inBacklog = true;
        task.scheduledStart = null;
        task.scheduledEnd = null;
        task.scheduleLocked = false;
      }
    }

    this.write(db);
  }

  private toDto(t: LocalTask): TaskDto {
    return {
      id: t.id,
      date: t.date,
      name: t.name,
      estimatedMinutes: t.estimatedMinutes,
      status: t.status,
      order: t.order,
      scheduledStart: t.scheduledStart,
      scheduledEnd: t.scheduledEnd,
      actualMinutes: t.actualMinutes,
      activeEntryId: t.activeEntryId,
      scheduleLocked: Boolean(t.scheduleLocked),
      meetLink: t.meetLink ?? null,
      sourceProvider: t.sourceProvider ?? null,
      sourceExternalId: t.sourceExternalId ?? null,
      notes: t.notes ?? null,
      inBacklog: Boolean(t.inBacklog),
    };
  }
}
