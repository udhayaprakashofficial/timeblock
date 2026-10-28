import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createId } from '../supabase/create-id';
import type {
  AiAccessDto,
  AiBrainDumpDto,
  AiBrainDumpRequestDto,
  AiCoachDto,
  AiCoachRequestDto,
  AiDailyPlanDto,
  AiDailyPlanRequestDto,
  AiEstimateDto,
  AiEstimateRequestDto,
  AiFocusDto,
  AiFocusRequestDto,
  AiPrioritizeDto,
  AiPrioritizeRequestDto,
  AiProposedTaskDto,
  AiRecoverDto,
  AiRecoverRequestDto,
  AiRecoveryAction,
  AiRecoveryMoveDto,
} from '@timeblock/shared-types';
import { UsersService } from '../users/users.service';
import { AiService } from './ai.service';
import { aiAccessDeniedReason, buildAiAccessDto } from './ai-access';
import { aiCreditsUnlimited } from './ai-credits';
import { AiCreditsStore } from './ai-credits.store';

@Injectable()
export class AiFeaturesService {
  constructor(
    private readonly ai: AiService,
    private readonly users: UsersService,
    private readonly credits: AiCreditsStore,
  ) {}

  async access(userId: string): Promise<AiAccessDto> {
    const me = await this.users.getMe(userId);
    const usage = await this.credits.getUsage(userId, me);
    return buildAiAccessDto({
      user: me,
      used: usage.used,
      month: usage.month,
    });
  }

  async assertAccess(userId: string): Promise<void> {
    const a = await this.access(userId);
    if (!a.hasAccess) {
      throw new ForbiddenException(
        a.reason ||
          aiAccessDeniedReason({
            isPro: a.isPro,
            refillLabel: a.refillLabel,
          }),
      );
    }
  }

  /** Charge 1 credit after a successful AI request (no charge on failure). */
  async charge(userId: string): Promise<void> {
    if (aiCreditsUnlimited()) return;
    const me = await this.users.getMe(userId);
    await this.credits.consume(userId, me);
  }

  async dailyPlan(
    userId: string,
    body: AiDailyPlanRequestDto,
  ): Promise<AiDailyPlanDto> {
    await this.assertAccess(userId);
    const date = this.requireDate(body.date);
    const goals = String(body.goals ?? '').trim();
    const existing = await this.ai.dayTasks(userId, date);
    const me = await this.users.getMe(userId);
    const defaultMins = me.defaultTaskMinutes || 30;

    const existingLines = existing
      .filter((t) => !String(t.status).includes('completed') || true)
      .map(
        (t) =>
          `- [${t.id}] ${t.name} · ${t.estimatedMinutes}m · ${t.status}${
            t.notes?.trim() ? ` · notes: ${t.notes.trim().slice(0, 120)}` : ''
          }`,
      )
      .join('\n');

    type Raw = {
      summary?: string;
      tasks?: Array<{
        name?: string;
        estimatedMinutes?: number;
        startTime?: string | null;
        endTime?: string | null;
        notes?: string | null;
      }>;
    };

    const raw = await this.ai.generateJson<Raw>(`You are Cupkey's daily planner.
Date: ${date}
User timezone default task minutes: ${defaultMins}
Goals / constraints: ${goals || '(none — plan a realistic focused day)'}

Existing tasks already on this day (do not duplicate; you may suggest additional work only):
${existingLines || '(none)'}

Propose 3–8 NEW tasks for a realistic day. Prefer deep work blocks of 25–90 minutes.
Use HH:mm 24h for optional startTime/endTime when helpful.

JSON shape:
{"summary":"one short paragraph","tasks":[{"name":"...","estimatedMinutes":45,"startTime":"09:30","endTime":"10:15","notes":null}]}`);

    const proposedTasks = this.normalizeProposed(raw.tasks, defaultMins);
    await this.charge(userId);
    return {
      date,
      summary: String(raw.summary ?? 'Proposed plan — review before applying.').trim(),
      proposedTasks,
      requiresApproval: true,
    };
  }

  async brainDump(
    userId: string,
    body: AiBrainDumpRequestDto,
  ): Promise<AiBrainDumpDto> {
    await this.assertAccess(userId);
    const date = this.requireDate(body.date);
    const text = String(body.text ?? '').trim();
    if (text.length < 3) {
      throw new BadRequestException('Paste a brain dump (at least a few words).');
    }
    const me = await this.users.getMe(userId);
    const defaultMins = me.defaultTaskMinutes || 30;

    type Raw = {
      tasks?: Array<{
        name?: string;
        estimatedMinutes?: number;
        notes?: string | null;
      }>;
    };

    const raw = await this.ai.generateJson<Raw>(`Turn this brain dump into concrete Cupkey tasks.
Date: ${date}
Default minutes: ${defaultMins}

Brain dump:
"""
${text.slice(0, 6000)}
"""

Split into clear actionable tasks (3–12). estimatedMinutes between 15 and 120.
JSON: {"tasks":[{"name":"...","estimatedMinutes":30,"notes":"optional"}]}`);

    await this.charge(userId);
    return {
      date,
      proposedTasks: this.normalizeProposed(raw.tasks, defaultMins),
      requiresApproval: true,
    };
  }

  async estimate(
    userId: string,
    body: AiEstimateRequestDto,
  ): Promise<AiEstimateDto> {
    await this.assertAccess(userId);
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('Task name is required');
    const date = body.date ? this.requireDate(body.date) : undefined;
    const context = String(body.context ?? '').trim();
    const me = await this.users.getMe(userId);
    const defaultMins = me.defaultTaskMinutes || 30;

    let history = '';
    if (date) {
      const day = await this.ai.dayTasks(userId, date);
      history = day
        .slice(0, 12)
        .map(
          (t) =>
            `- ${t.name}: planned ${t.estimatedMinutes}m, logged ${t.actualMinutes}m`,
        )
        .join('\n');
    }

    type Raw = { estimatedMinutes?: number; rationale?: string };
    const raw = await this.ai.generateJson<Raw>(`Estimate realistic minutes for a Cupkey task.
Task: ${name}
Context: ${context || '(none)'}
User default: ${defaultMins}m
Recent same-day tasks for calibration:
${history || '(none)'}

Return JSON: {"estimatedMinutes":45,"rationale":"one sentence"}
estimatedMinutes must be an integer from 15 to 180, prefer multiples of 5.`);

    let mins = Math.round(Number(raw.estimatedMinutes) || defaultMins);
    mins = Math.min(180, Math.max(15, mins));
    mins = Math.round(mins / 5) * 5;
    await this.charge(userId);
    return {
      name,
      estimatedMinutes: mins,
      rationale: String(raw.rationale ?? 'Based on similar work patterns.').trim(),
    };
  }

  async prioritize(
    userId: string,
    body: AiPrioritizeRequestDto,
  ): Promise<AiPrioritizeDto> {
    await this.assertAccess(userId);
    const date = this.requireDate(body.date);
    const tasks = (await this.ai.dayTasks(userId, date)).filter(
      (t) => t.status !== 'completed',
    );
    if (!tasks.length) {
      throw new BadRequestException('No open tasks to prioritize on this day.');
    }

    const lines = tasks
      .map(
        (t) =>
          `- id=${t.id} | ${t.name} | ${t.estimatedMinutes}m | notes=${(t.notes ?? '').slice(0, 80)}`,
      )
      .join('\n');

    type Raw = { orderedTaskIds?: string[]; rationale?: string };
    const raw = await this.ai.generateJson<Raw>(`Reorder these open Cupkey tasks for today ${date}.
Highest impact / urgency / focus first. Keep meetings/locked constraints in mind if names imply them.
Only use these ids:
${lines}

JSON: {"orderedTaskIds":["id1","id2"],"rationale":"short"}`);

    const ids = Array.isArray(raw.orderedTaskIds) ? raw.orderedTaskIds.map(String) : [];
    const known = new Set(tasks.map((t) => t.id));
    const ordered = ids.filter((id) => known.has(id));
    for (const t of tasks) {
      if (!ordered.includes(t.id)) ordered.push(t.id);
    }

    await this.charge(userId);
    return {
      date,
      orderedTaskIds: ordered,
      rationale: String(raw.rationale ?? 'Suggested order — apply to reorder your queue.').trim(),
      requiresApproval: true,
    };
  }

  async recover(
    userId: string,
    body: AiRecoverRequestDto,
  ): Promise<AiRecoverDto> {
    await this.assertAccess(userId);
    const date = this.requireDate(body.date);
    const note = String(body.note ?? '').trim();
    const tasks = await this.ai.dayTasks(userId, date);
    const open = tasks.filter((t) => t.status !== 'completed');
    if (!open.length) {
      throw new BadRequestException('Nothing left to recover — day looks clear.');
    }

    const lines = open
      .map(
        (t) =>
          `- id=${t.id} | ${t.name} | ${t.estimatedMinutes}m planned | ${t.actualMinutes}m logged | ${t.status}`,
      )
      .join('\n');

    type Raw = {
      summary?: string;
      moves?: Array<{
        taskId?: string;
        action?: string;
        startTime?: string | null;
        estimatedMinutes?: number | null;
        reason?: string;
      }>;
    };

    const raw = await this.ai.generateJson<Raw>(`The user's day is off-track. Suggest a recovery plan.
Date: ${date}
Note: ${note || '(running behind / overloaded)'}

Open tasks:
${lines}

For each task pick one action: keep | backlog | reschedule | shorten.
- backlog = park for later
- reschedule = new startTime HH:mm
- shorten = lower estimatedMinutes
Only use given task ids.

JSON: {"summary":"...","moves":[{"taskId":"...","action":"backlog","startTime":null,"estimatedMinutes":null,"reason":"..."}]}`);

    const byId = new Map(open.map((t) => [t.id, t]));
    const moves: AiRecoveryMoveDto[] = [];
    for (const m of raw.moves ?? []) {
      const id = String(m.taskId ?? '');
      const t = byId.get(id);
      if (!t) continue;
      const action = this.parseAction(m.action);
      moves.push({
        taskId: id,
        taskName: t.name,
        action,
        startTime: m.startTime ? String(m.startTime).slice(0, 5) : null,
        estimatedMinutes:
          m.estimatedMinutes != null
            ? Math.min(180, Math.max(15, Math.round(Number(m.estimatedMinutes))))
            : null,
        reason: String(m.reason ?? '').trim() || 'Recovery suggestion',
      });
    }

    await this.charge(userId);
    return {
      date,
      summary: String(raw.summary ?? 'Review these recovery moves before applying.').trim(),
      moves,
      requiresApproval: true,
    };
  }

  async coach(userId: string, body: AiCoachRequestDto): Promise<AiCoachDto> {
    await this.assertAccess(userId);
    const date = this.requireDate(body.date);
    const tasks = await this.ai.dayTasks(userId, date);
    const done = tasks.filter((t) => t.status === 'completed').length;
    const open = tasks.length - done;
    const logged = tasks.reduce((s, t) => s + (t.actualMinutes || 0), 0);
    const planned = tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);

    type Raw = { title?: string; body?: string; tips?: string[] };
    const raw = await this.ai.generateJson<Raw>(`Personal productivity coach for Cupkey.
Date: ${date}
Tasks: ${tasks.length} (${done} done, ${open} open)
Planned ${planned}m · Logged ${logged}m

Top tasks:
${tasks
  .slice(0, 10)
  .map((t) => `- ${t.name} (${t.status}, ${t.actualMinutes}/${t.estimatedMinutes}m)`)
  .join('\n') || '(none)'}

JSON: {"title":"short title","body":"2-3 supportive sentences grounded in the numbers","tips":["tip1","tip2","tip3"]}
No hustle porn. Honest, calm, specific.`);

    const tips = Array.isArray(raw.tips)
      ? raw.tips.map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
      : [];

    await this.charge(userId);
    return {
      date,
      title: String(raw.title ?? 'Coach').trim(),
      body: String(raw.body ?? '').trim(),
      tips,
    };
  }

  async focus(userId: string, body: AiFocusRequestDto): Promise<AiFocusDto> {
    await this.assertAccess(userId);
    const date = this.requireDate(body.date);
    const tasks = await this.ai.dayTasks(userId, date);
    const taskId = body.taskId ? String(body.taskId) : null;
    const live = tasks.find((t) => t.id === taskId) ||
      tasks.find((t) => t.status === 'in_progress') ||
      tasks.find((t) => t.status !== 'completed') ||
      null;

    type Raw = { message?: string; suggestion?: string };
    const raw = await this.ai.generateJson<Raw>(`Focus assistant for the next work block.
Date: ${date}
Current task: ${live ? `${live.name} (${live.estimatedMinutes}m, ${live.status})` : '(idle)'}
Notes: ${live?.notes?.slice(0, 400) || '(none)'}

JSON: {"message":"one short focus line","suggestion":"one concrete next action under 20 words"}`);

    await this.charge(userId);
    return {
      date,
      taskId: live?.id ?? null,
      taskName: live?.name ?? null,
      message: String(raw.message ?? 'One thing at a time.').trim(),
      suggestion: String(raw.suggestion ?? 'Start the timer and finish the next small slice.').trim(),
    };
  }

  private requireDate(raw: unknown): string {
    const date = String(raw ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    return date;
  }

  private parseAction(raw: unknown): AiRecoveryAction {
    const v = String(raw ?? 'keep');
    if (
      v === 'keep' ||
      v === 'backlog' ||
      v === 'reschedule' ||
      v === 'shorten'
    ) {
      return v;
    }
    return 'keep';
  }

  private normalizeProposed(
    tasks: Array<{
      name?: string;
      estimatedMinutes?: number;
      startTime?: string | null;
      endTime?: string | null;
      notes?: string | null;
    }> | undefined,
    defaultMins: number,
  ): AiProposedTaskDto[] {
    if (!Array.isArray(tasks)) return [];
    const out: AiProposedTaskDto[] = [];
    for (const t of tasks) {
      const name = String(t.name ?? '').trim();
      if (!name) continue;
      let mins = Math.round(Number(t.estimatedMinutes) || defaultMins);
      mins = Math.min(180, Math.max(15, mins));
      mins = Math.round(mins / 5) * 5;
      out.push({
        key: createId(),
        name: name.slice(0, 200),
        estimatedMinutes: mins,
        startTime: t.startTime ? String(t.startTime).slice(0, 5) : null,
        endTime: t.endTime ? String(t.endTime).slice(0, 5) : null,
        notes: t.notes != null ? String(t.notes).slice(0, 500) : null,
        taskId: null,
      });
      if (out.length >= 12) break;
    }
    return out;
  }
}
