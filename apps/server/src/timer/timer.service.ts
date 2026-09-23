import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { LocalDataStore } from '../auth/local-data.store';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
import { todayInTimeZone, normalizeTimeZone } from '../common/time.util';

@Injectable()
export class TimerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly local: LocalDataStore,
    private readonly supabase: SupabaseRestService,
    private readonly db: DbBridgeService,
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
    if (this.supabase.isConfigured()) {
      const user = await this.supabase.getUserById(userId);
      if (user?.timezone) return normalizeTimeZone(user.timezone);
    }
    return 'UTC';
  }

  private assertNotFutureDay(taskDate: string, timeZone: string) {
    const today = todayInTimeZone(timeZone);
    const day = String(taskDate).slice(0, 10);
    if (day > today) {
      throw new BadRequestException('Cannot start a timer on a future day');
    }
  }

  async start(userId: string, taskId: string) {
    if (this.db.useDb()) {
      try {
        const id = await this.db.resolveUserId(userId);
        const tz = await this.resolveTimeZone(id);
        const rows = await this.supabase.select<{ date: string }>(
          'Task',
          'date',
          { filter: `id=eq.${taskId}&userId=eq.${id}`, limit: 1 },
        );
        if (rows[0]?.date) this.assertNotFutureDay(String(rows[0].date), tz);
        return await this.supabase.startTimer(id, taskId);
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) throw new NotFoundException('Task not found');
        if (msg.includes('already completed')) {
          throw new BadRequestException('Task already completed');
        }
        if (msg.includes('already running')) {
          throw new BadRequestException('Timer already running for this task');
        }
        if (msg.includes('future day')) {
          throw new BadRequestException('Cannot start a timer on a future day');
        }
        console.warn('[timer] DB start failed', msg);
      }
    }

    if (userId.startsWith('local_')) {
      try {
        return this.local.startTimer(userId, taskId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('future day')) {
          throw new BadRequestException('Cannot start a timer on a future day');
        }
        if (msg.includes('already completed')) {
          throw new BadRequestException('Task already completed');
        }
        if (msg.includes('already running')) {
          throw new BadRequestException('Timer already running for this task');
        }
        throw new NotFoundException('Task not found');
      }
    }
    try {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
        include: { timeEntries: true },
      });
      if (!task) throw new NotFoundException('Task not found');
      const tz = await this.resolveTimeZone(userId);
      this.assertNotFutureDay(task.date.toISOString().slice(0, 10), tz);
      if (task.status === 'completed') {
        throw new BadRequestException('Task already completed');
      }
      if (task.timeEntries.some((e) => !e.endedAt)) {
        throw new BadRequestException('Timer already running for this task');
      }

      await this.stopOtherOpenTimersPrisma(userId, taskId);

      await this.prisma.timeEntry.create({
        data: { taskId, startedAt: new Date() },
      });
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'in_progress' },
      });

      const date = task.date.toISOString().slice(0, 10);
      const tasks = await this.tasksService.list(userId, date);
      return tasks.find((t) => t.id === taskId);
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      return this.local.startTimer(userId, taskId);
    }
  }

  async stop(userId: string, taskId: string) {
    if (this.db.useDb()) {
      try {
        const id = await this.db.resolveUserId(userId);
        return await this.supabase.stopTimer(id, taskId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) throw new NotFoundException('Task not found');
        if (msg.includes('No active')) {
          throw new BadRequestException('No active timer');
        }
        console.warn('[timer] DB stop failed', msg);
      }
    }

    if (userId.startsWith('local_')) {
      try {
        return this.local.stopTimer(userId, taskId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('No active')) {
          throw new BadRequestException('No active timer');
        }
        throw new NotFoundException('Task not found');
      }
    }
    try {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
        include: { timeEntries: true },
      });
      if (!task) throw new NotFoundException('Task not found');
      const active = task.timeEntries.find((e) => !e.endedAt);
      if (!active) throw new BadRequestException('No active timer');

      const endedAt = new Date();
      const actualMinutes = Math.max(
        1,
        Math.round((endedAt.getTime() - active.startedAt.getTime()) / 60000),
      );
      await this.prisma.timeEntry.update({
        where: { id: active.id },
        data: { endedAt, actualMinutes },
      });
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: task.status === 'completed' ? 'completed' : 'pending',
        },
      });

      const date = task.date.toISOString().slice(0, 10);
      const tasks = await this.tasksService.list(userId, date);
      return tasks.find((t) => t.id === taskId);
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      return this.local.stopTimer(userId, taskId);
    }
  }

  private async stopOtherOpenTimersPrisma(userId: string, exceptTaskId: string) {
    const open = await this.prisma.timeEntry.findMany({
      where: {
        endedAt: null,
        task: { userId },
        NOT: { taskId: exceptTaskId },
      },
      include: { task: true },
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
      if (entry.task.status !== 'completed') {
        await this.prisma.task.update({
          where: { id: entry.taskId },
          data: { status: 'pending' },
        });
      }
    }
  }
}
