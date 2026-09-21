import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createId } from './create-id';
import { dayBoundsInTimeZone, toUtcIso, parseHm, combineDateAndMinutes, elapsedMinutes, entryActualMinutes } from '../common/time.util';

type Json = Record<string, unknown>;

function normalizeHm(value: string, fallback = '09:00'): string {
  const m = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1]) || 0));
  const min = Math.min(59, Math.max(0, Number(m[2]) || 0));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Writes/reads app tables over Supabase PostgREST (HTTPS).
 * Used when the Prisma Postgres port is blocked but HTTPS works.
 */
@Injectable()
export class SupabaseRestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupabaseRestService.name);
  private ok = false;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  private get baseUrl() {
    return (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  }

  private get apiKey() {
    return (
      process.env.SUPABASE_SECRET_KEY?.trim() ||
      process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
      ''
    );
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  isReady() {
    return this.ok;
  }

  async onModuleInit() {
    if (!this.isConfigured()) {
      this.logger.warn('SUPABASE_URL / SUPABASE_SECRET_KEY not set');
      return;
    }
    const ready = await this.ping();
    if (!ready) {
      this.logger.warn(
        'Supabase REST not reachable yet — retrying until connected',
      );
    }
    this.keepAlive = setInterval(() => {
      void this.ping().then((ok) => {
        if (!ok) {
          this.logger.warn('Supabase REST keepalive failed — will retry');
        }
      });
    }, this.ok ? 45_000 : 8_000);
  }

  async ping() {
    if (!this.isConfigured()) return false;
    try {
      await this.select('User', 'id', { limit: 1 });
      const was = this.ok;
      this.ok = true;
      if (!was) {
        this.logger.log('Supabase REST API reachable — DB writes via HTTPS enabled');
        await this.syncLocalUsersIfPresent();
        this.rescheduleKeepAlive();
      }
      return true;
    } catch (err) {
      const was = this.ok;
      this.ok = false;
      if (was) {
        this.logger.warn(
          `Supabase REST lost: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.rescheduleKeepAlive();
      }
      return false;
    }
  }

  private rescheduleKeepAlive() {
    if (!this.keepAlive) return;
    clearInterval(this.keepAlive);
    this.keepAlive = setInterval(() => {
      void this.ping();
    }, this.ok ? 45_000 : 8_000);
  }

  onModuleDestroy() {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }

  private headers(extra?: Record<string, string>) {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit & { prefer?: string } = {},
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('Supabase REST is not configured');
    }
    const prefer = init.prefer;
    const { prefer: _p, headers: initHeaders, ...rest } = init as RequestInit & {
      prefer?: string;
    };
    const extra: Record<string, string> = {
      ...(initHeaders as Record<string, string> | undefined),
    };
    if (prefer) extra.Prefer = prefer;
    const res = await fetch(`${this.baseUrl}/rest/v1/${path}`, {
      ...rest,
      headers: this.headers(extra),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Supabase REST ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!text) return [] as T;
    return JSON.parse(text) as T;
  }

  async select<T extends Json = Json>(
    table: string,
    columns = '*',
    opts?: { filter?: string; limit?: number; order?: string },
  ): Promise<T[]> {
    const params = new URLSearchParams();
    params.set('select', columns);
    if (opts?.limit != null) params.set('limit', String(opts.limit));
    if (opts?.order) params.set('order', opts.order);
    const filter = opts?.filter ? `&${opts.filter}` : '';
    return this.request<T[]>(`${table}?${params.toString()}${filter}`);
  }

  async insert<T extends Json = Json>(
    table: string,
    row: Json | Json[],
  ): Promise<T[]> {
    return this.request<T[]>(table, {
      method: 'POST',
      body: JSON.stringify(row),
      prefer: 'return=representation',
    });
  }

  async upsert<T extends Json = Json>(
    table: string,
    row: Json | Json[],
    onConflict: string,
  ): Promise<T[]> {
    return this.request<T[]>(
      `${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: 'POST',
        body: JSON.stringify(row),
        prefer: 'resolution=merge-duplicates,return=representation',
      },
    );
  }

  async patch<T extends Json = Json>(
    table: string,
    filter: string,
    patch: Json,
  ): Promise<T[]> {
    return this.request<T[]>(`${table}?${filter}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      prefer: 'return=representation',
    });
  }

  async delete(table: string, filter: string): Promise<void> {
    await this.request(`${table}?${filter}`, { method: 'DELETE' });
  }

  /** Upsert Google login into User + OAuthAccount over HTTPS. */
  async upsertGoogleUser(input: {
    email: string;
    name: string;
    googleId: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string | null;
  }): Promise<{
    id: string;
    name: string;
    email: string;
    theme: string;
    timezone: string;
    onboardingCompleted?: boolean;
  }> {
    const email = input.email.toLowerCase();
    const existing = await this.select<{
      id: string;
      name: string;
      email: string;
      theme: string;
      timezone: string;
      onboardingCompleted?: boolean;
    }>('User', 'id,name,email,theme,timezone,defaultTaskMinutes', {
      filter: `email=eq.${encodeURIComponent(email)}`,
      limit: 1,
    });

    let user:
      | {
          id: string;
          name: string;
          email: string;
          theme: string;
          timezone: string;
          onboardingCompleted?: boolean;
        }
      | undefined = existing[0];
    if (!user) {
      const id = createId();
      const now = new Date().toISOString();
      try {
        const created = await this.insert<{
          id: string;
          name: string;
          email: string;
          theme: string;
          timezone: string;
        }>('User', {
          id,
          name: input.name,
          email,
          theme: 'light',
          timezone: 'UTC',
          onboardingCompleted: false,
          createdAt: now,
          updatedAt: now,
        });
        user = { ...created[0], onboardingCompleted: false };
      } catch {
        const created = await this.insert<{
          id: string;
          name: string;
          email: string;
          theme: string;
          timezone: string;
        }>('User', {
          id,
          name: input.name,
          email,
          theme: 'light',
          timezone: 'UTC',
          createdAt: now,
          updatedAt: now,
        });
        user = { ...created[0], onboardingCompleted: false };
      }
    } else if (user.name !== input.name) {
      const updated = await this.patch<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
      }>('User', `id=eq.${user.id}`, {
        name: input.name,
        updatedAt: new Date().toISOString(),
      });
      user = updated[0] ?? { ...user, name: input.name };
    }

    const now = new Date().toISOString();
    const oauthRows = await this.select<{ id: string }>('OAuthAccount', 'id', {
      filter: `userId=eq.${user.id}&provider=eq.google`,
      limit: 1,
    });

    if (oauthRows[0]) {
      const patch: Record<string, unknown> = {
        providerAccountId: input.googleId,
        accessTokenEncrypted: input.accessTokenEncrypted,
        scope: 'calendar.readonly email profile',
        updatedAt: now,
      };
      // Never wipe an existing refresh token when GIS login omits one
      if (input.refreshTokenEncrypted) {
        patch.refreshTokenEncrypted = input.refreshTokenEncrypted;
      }
      await this.patch('OAuthAccount', `id=eq.${oauthRows[0].id}`, patch);
    } else {
      await this.insert('OAuthAccount', {
        id: createId(),
        userId: user.id,
        provider: 'google',
        providerAccountId: input.googleId,
        accessTokenEncrypted: input.accessTokenEncrypted,
        refreshTokenEncrypted: input.refreshTokenEncrypted ?? null,
        scope: 'calendar.readonly email profile',
        createdAt: now,
        updatedAt: now,
      });
    }

    this.ok = true;
    return user;
  }

  async getUserByEmail(email: string) {
    const rows = await this.select<{
      id: string;
      name: string;
      email: string;
      theme: string;
      timezone: string;
      passwordHash: string | null;
    }>('User', 'id,name,email,theme,timezone,passwordHash,defaultTaskMinutes', {
      filter: `email=eq.${encodeURIComponent(email.toLowerCase())}`,
      limit: 1,
    });
    return rows[0] ?? null;
  }

  async getUserById(id: string) {
    try {
      const rows = await this.select<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
        onboardingCompleted?: boolean;
      }>('User', 'id,name,email,theme,timezone,defaultTaskMinutes,onboardingCompleted', {
        filter: `id=eq.${id}`,
        limit: 1,
      });
      return rows[0] ?? null;
    } catch {
      const rows = await this.select<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
      }>('User', 'id,name,email,theme,timezone,defaultTaskMinutes', {
        filter: `id=eq.${id}`,
        limit: 1,
      });
      return rows[0] ? { ...rows[0], onboardingCompleted: true } : null;
    }
  }

  async createPasswordUser(input: {
    email: string;
    name: string;
    passwordHash: string;
  }) {
    const id = createId();
    const now = new Date().toISOString();
    const base = {
      id,
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      theme: 'light',
      timezone: 'UTC',
      createdAt: now,
      updatedAt: now,
    };
    try {
      const created = await this.insert<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
      }>('User', { ...base, onboardingCompleted: false });
      return { ...created[0], onboardingCompleted: false as boolean };
    } catch {
      const created = await this.insert<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
      }>('User', base);
      return { ...created[0], onboardingCompleted: false as boolean };
    }
  }


  async listCalendarEvents(
    userId: string,
    dateStr: string,
    timeZone?: string | null,
  ) {
    const { start, end } = dayBoundsInTimeZone(dateStr, timeZone);
    const dayStart = start.toISOString();
    const dayEnd = end.toISOString();
    const rows = await this.select<{
      id: string;
      provider: string;
      externalId: string;
      title: string;
      start: string;
      end: string;
      meetLink: string | null;
    }>('CalendarEvent', 'id,provider,externalId,title,start,end,meetLink', {
      filter: `userId=eq.${userId}&start=lt.${dayEnd}&end=gt.${dayStart}`,
      order: 'start.asc',
    });
    return rows.map((e) => ({
      id: e.id,
      provider: e.provider,
      externalId: e.externalId,
      title: e.title,
      start: toUtcIso(e.start) ?? e.start,
      end: toUtcIso(e.end) ?? e.end,
      meetLink: e.meetLink ?? null,
    }));
  }

  async upsertCalendarEvent(row: {
    userId: string;
    provider: string;
    externalId: string;
    title: string;
    start: string;
    end: string;
    meetLink?: string | null;
  }) {
    const existing = await this.select<{ id: string }>('CalendarEvent', 'id', {
      filter: `userId=eq.${row.userId}&provider=eq.${row.provider}&externalId=eq.${encodeURIComponent(row.externalId)}`,
      limit: 1,
    });
    const now = new Date().toISOString();
    if (existing[0]) {
      await this.patch('CalendarEvent', `id=eq.${existing[0].id}`, {
        title: row.title,
        start: row.start,
        end: row.end,
        meetLink: row.meetLink ?? null,
        updatedAt: now,
      });
      return existing[0].id;
    }
    const id = createId();
    await this.insert('CalendarEvent', {
      id,
      userId: row.userId,
      provider: row.provider,
      externalId: row.externalId,
      title: row.title,
      start: row.start,
      end: row.end,
      meetLink: row.meetLink ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async getOAuthAccount(userId: string, provider: string) {
    const rows = await this.select<{
      id: string;
      accessTokenEncrypted: string;
      refreshTokenEncrypted: string | null;
      expiresAt: string | null;
    }>(
      'OAuthAccount',
      'id,accessTokenEncrypted,refreshTokenEncrypted,expiresAt',
      {
        filter: `userId=eq.${userId}&provider=eq.${provider}`,
        limit: 1,
      },
    );
    return rows[0] ?? null;
  }

  async listOAuthAccounts(userId?: string) {
    const filter = userId ? `userId=eq.${userId}` : undefined;
    return this.select<{
      id: string;
      userId: string;
      provider: string;
      accessTokenEncrypted: string;
      refreshTokenEncrypted: string | null;
    }>('OAuthAccount', 'id,userId,provider,accessTokenEncrypted,refreshTokenEncrypted', {
      filter,
    });
  }

  async listOAuthProviders(userId: string): Promise<string[]> {
    const rows = await this.select<{ provider: string }>(
      'OAuthAccount',
      'provider',
      { filter: `userId=eq.${userId}` },
    );
    return rows.map((r) => r.provider);
  }

  /** One-shot: push apps/server/data/local-users.json into User + OAuthAccount. */
  private syncing = false;
  private async syncLocalUsersIfPresent() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const { existsSync, readFileSync } = await import('fs');
      const { resolve } = await import('path');
      const { createCipheriv, randomBytes, scryptSync } = await import('crypto');
      const file = resolve(__dirname, '../../data/local-users.json');
      if (!existsSync(file)) return;
      const { users } = JSON.parse(readFileSync(file, 'utf8')) as {
        users: Array<{
          email: string;
          name?: string;
          theme?: string;
          googleId?: string;
          accessToken?: string;
          refreshToken?: string;
        }>;
      };
      if (!users?.length) return;

      const encrypt = (plaintext: string) => {
        const secret =
          process.env.TOKEN_ENCRYPTION_KEY ?? 'dev-encryption-key-change-me';
        const key = scryptSync(secret, 'timeblock-salt', 32);
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([
          cipher.update(plaintext, 'utf8'),
          cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]).toString('base64');
      };

      for (const u of users) {
        if (!u.email || !u.googleId || !u.accessToken) continue;
        const user = await this.upsertGoogleUser({
          email: u.email,
          name: u.name || u.email,
          googleId: String(u.googleId),
          accessTokenEncrypted: encrypt(u.accessToken),
          refreshTokenEncrypted: u.refreshToken ? encrypt(u.refreshToken) : null,
        });
        this.logger.log(`Synced local user → DB: ${user.email} (${user.id})`);
      }
    } catch (err) {
      this.logger.warn(
        `Local user sync skipped: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.syncing = false;
    }
  }

  async listTasks(userId: string, dateStr: string) {
    const rows = await this.select<Record<string, unknown>>(
      'Task',
      '*',
      {
        filter: `userId=eq.${userId}&date=eq.${dateStr}&inBacklog=eq.false`,
        order: 'order.asc',
      },
    ).catch(async () =>
      // Fallback before migration: no inBacklog column
      this.select<Record<string, unknown>>('Task', '*', {
        filter: `userId=eq.${userId}&date=eq.${dateStr}`,
        order: 'order.asc',
      }),
    );
    const out = [];
    for (const t of rows) {
      if (t.inBacklog === true) continue;
      let entries = await this.select<Record<string, unknown>>(
        'TimeEntry',
        '*',
        { filter: `taskId=eq.${t.id}` },
      );
      // Repair IST-offset bad actualMinutes written by naive Date parsing
      for (const e of entries) {
        if (!e.endedAt || !e.startedAt) continue;
        const correct = entryActualMinutes(e);
        const stored = Number(e.actualMinutes) || 0;
        if (correct > 0 && Math.abs(correct - stored) > 5) {
          await this.patch('TimeEntry', `id=eq.${e.id}`, {
            actualMinutes: correct,
          });
          e.actualMinutes = correct;
        }
      }
      const logged = entries.reduce(
        (sum, e) => sum + entryActualMinutes(e),
        0,
      );
      // Repair older checkbox-completes that never created a TimeEntry
      if (String(t.status) === 'completed' && logged <= 0) {
        const mins = Math.max(1, Number(t.estimatedMinutes) || 30);
        const endedAt = new Date();
        const startedAt = new Date(endedAt.getTime() - mins * 60_000);
        await this.insert('TimeEntry', {
          id: createId(),
          taskId: String(t.id),
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          actualMinutes: mins,
          createdAt: endedAt.toISOString(),
        });
        entries = await this.select<Record<string, unknown>>('TimeEntry', '*', {
          filter: `taskId=eq.${t.id}`,
        });
      }
      out.push(this.mapTaskRow(t, entries));
    }
    return out;
  }

  async listBacklogTasks(userId: string) {
    try {
      const rows = await this.select<Record<string, unknown>>('Task', '*', {
        filter: `userId=eq.${userId}&inBacklog=eq.true&status=in.(pending,in_progress)`,
        order: 'date.asc,order.asc',
      });
      const out = [];
      for (const t of rows) {
        const entries = await this.select<Record<string, unknown>>(
          'TimeEntry',
          '*',
          { filter: `taskId=eq.${t.id}` },
        );
        out.push(this.mapTaskRow(t, entries));
      }
      return out;
    } catch {
      return [];
    }
  }

  async carryOverUnfinished(userId: string, today: string): Promise<number> {
    try {
      const rows = await this.select<{ id: string }>('Task', 'id', {
        filter: `userId=eq.${userId}&inBacklog=eq.false&scheduleLocked=eq.false&status=in.(pending,in_progress)&date=lt.${today}`,
      });
      const now = new Date().toISOString();
      for (const row of rows) {
        await this.patch('Task', `id=eq.${row.id}`, {
          inBacklog: true,
          scheduledStart: null,
          scheduledEnd: null,
          updatedAt: now,
        });
      }
      return rows.length;
    } catch {
      return 0;
    }
  }

  async scheduleFromBacklog(userId: string, taskId: string, dateStr: string) {
    const rows = await this.select<Record<string, unknown>>('Task', '*', {
      filter: `id=eq.${taskId}&userId=eq.${userId}`,
      limit: 1,
    });
    if (!rows[0]) throw new Error('Task not found');
    const existing = await this.select<{ order: number }>('Task', 'order', {
      filter: `userId=eq.${userId}&date=eq.${dateStr}&inBacklog=eq.false`,
      order: 'order.desc',
      limit: 1,
    }).catch(async () =>
      this.select<{ order: number }>('Task', 'order', {
        filter: `userId=eq.${userId}&date=eq.${dateStr}`,
        order: 'order.desc',
        limit: 1,
      }),
    );
    const order = (existing[0]?.order ?? -1) + 1;
    const updated = await this.patch<Record<string, unknown>>(
      'Task',
      `id=eq.${taskId}&userId=eq.${userId}`,
      {
        date: dateStr,
        inBacklog: false,
        scheduleLocked: false,
        scheduledStart: null,
        scheduledEnd: null,
        order,
        updatedAt: new Date().toISOString(),
      },
    );
    const entries = await this.select<Record<string, unknown>>('TimeEntry', '*', {
      filter: `taskId=eq.${taskId}`,
    });
    return this.mapTaskRow(updated[0] ?? { ...rows[0], date: dateStr, inBacklog: false }, entries);
  }

  async createTask(
    userId: string,
    dto: {
      date: string;
      name: string;
      estimatedMinutes: number;
      scheduledStart?: string | null;
      scheduledEnd?: string | null;
      scheduleLocked?: boolean;
      inBacklog?: boolean;
    },
  ) {
    const existing = await this.select<{ order: number }>('Task', 'order', {
      filter: `userId=eq.${userId}&date=eq.${dto.date}&inBacklog=eq.false`,
      order: 'order.desc',
      limit: 1,
    }).catch(async () =>
      this.select<{ order: number }>('Task', 'order', {
        filter: `userId=eq.${userId}&date=eq.${dto.date}`,
        order: 'order.desc',
        limit: 1,
      }),
    );
    const order = (existing[0]?.order ?? -1) + 1;
    const now = new Date().toISOString();
    const id = createId();
    const scheduleLocked = Boolean(dto.scheduleLocked);
    const inBacklog = Boolean(dto.inBacklog);
    const payload: Record<string, unknown> = {
      id,
      userId,
      date: dto.date,
      name: dto.name.trim(),
      estimatedMinutes: dto.estimatedMinutes,
      status: 'pending',
      order,
      scheduledStart: dto.scheduledStart ?? null,
      scheduledEnd: dto.scheduledEnd ?? null,
      scheduleLocked,
      notes: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!inBacklog) payload.inBacklog = false;
    else payload.inBacklog = true;
    let created: Record<string, unknown>[];
    try {
      created = await this.insert<Record<string, unknown>>('Task', payload);
    } catch {
      delete payload.inBacklog;
      created = await this.insert<Record<string, unknown>>('Task', payload);
    }
    return this.mapTaskRow(
      created[0] ?? {
        id,
        ...dto,
        name: dto.name.trim(),
        status: 'pending',
        order,
        scheduleLocked,
        inBacklog,
        scheduledStart: dto.scheduledStart ?? null,
        scheduledEnd: dto.scheduledEnd ?? null,
      },
      [],
    );
  }

  async updateTaskNotes(
    userId: string,
    taskId: string,
    notes: string | null,
  ) {
    return this.updateTask(userId, taskId, { notes }, 'UTC');
  }

  async updateTask(
    userId: string,
    taskId: string,
    dto: {
      name?: string;
      notes?: string | null;
      estimatedMinutes?: number;
      startTime?: string | null;
      endTime?: string | null;
      unlockSchedule?: boolean;
      inBacklog?: boolean;
      date?: string;
      order?: number;
    },
    timeZone: string,
  ) {
    const rows = await this.select<Record<string, unknown>>('Task', '*', {
      filter: `id=eq.${taskId}&userId=eq.${userId}`,
      limit: 1,
    });
    if (!rows[0]) throw new Error('Task not found');

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.notes !== undefined) {
      patch.notes =
        dto.notes == null ? null : String(dto.notes).trim() || null;
    }
    if (dto.estimatedMinutes !== undefined) {
      patch.estimatedMinutes = Math.round(Number(dto.estimatedMinutes));
    }
    if (dto.order !== undefined) patch.order = Math.max(0, Math.round(dto.order));
    if (dto.date !== undefined) patch.date = dto.date;
    if (dto.inBacklog === true) {
      patch.inBacklog = true;
      patch.scheduledStart = null;
      patch.scheduledEnd = null;
      patch.scheduleLocked = false;
    } else if (dto.inBacklog === false) {
      patch.inBacklog = false;
    }
    if (dto.unlockSchedule) {
      patch.scheduleLocked = false;
      patch.scheduledStart = null;
      patch.scheduledEnd = null;
    }
    const startTime =
      dto.startTime === null ? null : dto.startTime?.trim() || undefined;
    const endTime =
      dto.endTime === null ? null : dto.endTime?.trim() || undefined;
    if (startTime || endTime) {
      if (!startTime || !endTime) {
        throw new Error('Both start and end time are required');
      }
      const startMin = parseHm(startTime);
      const endMin = parseHm(endTime);
      if (!(endMin > startMin)) {
        throw new Error('End time must be after start time');
      }
      const dateStr =
        dto.date ??
        (typeof rows[0].date === 'string'
          ? String(rows[0].date).slice(0, 10)
          : String(rows[0].date).slice(0, 10));
      patch.scheduledStart = combineDateAndMinutes(
        dateStr,
        startMin,
        timeZone,
      ).toISOString();
      patch.scheduledEnd = combineDateAndMinutes(
        dateStr,
        endMin,
        timeZone,
      ).toISOString();
      patch.scheduleLocked = true;
      patch.estimatedMinutes = endMin - startMin;
      patch.inBacklog = false;
    }

    const updated = await this.patch<Record<string, unknown>>(
      'Task',
      `id=eq.${taskId}&userId=eq.${userId}`,
      patch,
    );
    const entries = await this.select<Record<string, unknown>>('TimeEntry', '*', {
      filter: `taskId=eq.${taskId}`,
    });
    return this.mapTaskRow(updated[0] ?? { ...rows[0], ...patch }, entries);
  }

  async completeTask(userId: string, taskId: string) {
    const rows = await this.select<Record<string, unknown>>('Task', '*', {
      filter: `id=eq.${taskId}&userId=eq.${userId}`,
      limit: 1,
    });
    if (!rows[0]) throw new Error('Task not found');
    // Close any open timer before marking done
    await this.closeOpenEntriesForTask(taskId);
    let entries = await this.select<Record<string, unknown>>('TimeEntry', '*', {
      filter: `taskId=eq.${taskId}`,
    });
    const logged = entries.reduce(
      (sum, e) => sum + entryActualMinutes(e),
      0,
    );
    // Done without a live session → credit estimated minutes as a closed entry
    if (logged <= 0) {
      const mins = Math.max(1, Number(rows[0].estimatedMinutes) || 30);
      const endedAt = new Date();
      const startedAt = new Date(endedAt.getTime() - mins * 60_000);
      await this.insert('TimeEntry', {
        id: createId(),
        taskId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        actualMinutes: mins,
        createdAt: endedAt.toISOString(),
      });
      entries = await this.select<Record<string, unknown>>('TimeEntry', '*', {
        filter: `taskId=eq.${taskId}`,
      });
    }
    const updated = await this.patch<Record<string, unknown>>(
      'Task',
      `id=eq.${taskId}`,
      { status: 'completed', updatedAt: new Date().toISOString() },
    );
    return this.mapTaskRow(updated[0] ?? rows[0], entries);
  }

  async deleteTask(userId: string, taskId: string) {
    const rows = await this.select<{ id: string }>('Task', 'id', {
      filter: `id=eq.${taskId}&userId=eq.${userId}`,
      limit: 1,
    });
    if (!rows[0]) throw new Error('Task not found');
    await this.delete('TimeEntry', `taskId=eq.${taskId}`);
    await this.delete('Task', `id=eq.${taskId}`);
  }

  async listSchedule(userId: string) {
    const templates = await this.select<Record<string, unknown>>(
      'DailyScheduleTemplate',
      '*',
      { filter: `userId=eq.${userId}`, order: 'weekday.asc' },
    );
    const out = [];
    for (const t of templates) {
      let breaks: Record<string, unknown>[] = [];
      try {
        breaks = await this.select<Record<string, unknown>>('Break', '*', {
          filter: `templateId=eq.${t.id}`,
        });
      } catch (err) {
        this.logger.warn(
          `Break fetch failed for template ${String(t.id)}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      out.push({
        id: String(t.id),
        weekday: Number(t.weekday),
        workStart: normalizeHm(String(t.workStart)),
        workEnd: normalizeHm(String(t.workEnd)),
        breaks: breaks.map((b) => ({
          id: String(b.id),
          name: String(b.name),
          start: normalizeHm(String(b.start)),
          end: normalizeHm(String(b.end)),
        })),
      });
    }
    return out;
  }

  async upsertSchedule(
    userId: string,
    dto: {
      weekday: number;
      workStart: string;
      workEnd: string;
      breaks: Array<{ name: string; start: string; end: string }>;
    },
  ) {
    const workStart = normalizeHm(dto.workStart, '09:00');
    const workEnd = normalizeHm(dto.workEnd, '18:00');
    const breakRows = (dto.breaks ?? []).map((b) => ({
      name: (b.name || 'Break').trim() || 'Break',
      start: normalizeHm(b.start, '12:00'),
      end: normalizeHm(b.end, '13:00'),
    }));
    const existing = await this.select<{ id: string }>(
      'DailyScheduleTemplate',
      'id',
      {
        filter: `userId=eq.${userId}&weekday=eq.${dto.weekday}`,
        limit: 1,
      },
    );
    const now = new Date().toISOString();
    let templateId: string;
    if (existing[0]) {
      templateId = existing[0].id;
      await this.patch('DailyScheduleTemplate', `id=eq.${templateId}`, {
        workStart,
        workEnd,
        updatedAt: now,
      });
      try {
        await this.delete('Break', `templateId=eq.${templateId}`);
      } catch (err) {
        this.logger.warn(
          `Break delete failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    } else {
      templateId = createId();
      await this.insert('DailyScheduleTemplate', {
        id: templateId,
        userId,
        weekday: dto.weekday,
        workStart,
        workEnd,
        createdAt: now,
        updatedAt: now,
      });
    }
    const breaks = [];
    for (const b of breakRows) {
      const id = createId();
      await this.insert('Break', {
        id,
        templateId,
        name: b.name,
        start: b.start,
        end: b.end,
      });
      breaks.push({ id, name: b.name, start: b.start, end: b.end });
    }
    return {
      id: templateId,
      weekday: dto.weekday,
      workStart,
      workEnd,
      breaks,
    };
  }

  /** Seed Mon–Fri 09–18 + lunch when the user has no templates yet. */
  async ensureDefaultSchedule(userId: string) {
    const existing = await this.select<{ id: string }>(
      'DailyScheduleTemplate',
      'id',
      { filter: `userId=eq.${userId}`, limit: 1 },
    );
    if (existing.length) return;
    const now = new Date().toISOString();
    for (const weekday of [1, 2, 3, 4, 5]) {
      const templateId = createId();
      await this.insert('DailyScheduleTemplate', {
        id: templateId,
        userId,
        weekday,
        workStart: '09:00',
        workEnd: '18:00',
        createdAt: now,
        updatedAt: now,
      });
      try {
        await this.insert('Break', {
          id: createId(),
          templateId,
          name: 'Lunch',
          start: '12:00',
          end: '13:00',
        });
      } catch {
        /* optional */
      }
    }
  }


  async startTimer(userId: string, taskId: string) {
    const rows = await this.select<Record<string, unknown>>('Task', '*', {
      filter: `id=eq.${taskId}&userId=eq.${userId}`,
      limit: 1,
    });
    if (!rows[0]) throw new Error('Task not found');
    if (String(rows[0].status) === 'completed') {
      throw new Error('Task already completed');
    }
    const entries = await this.select<Record<string, unknown>>('TimeEntry', '*', {
      filter: `taskId=eq.${taskId}`,
    });
    if (entries.some((e) => !e.endedAt)) {
      throw new Error('Timer already running for this task');
    }
    // Only one active timer per user — stop others first
    await this.stopOtherOpenTimers(userId, taskId);
    const now = new Date().toISOString();
    await this.insert('TimeEntry', {
      id: createId(),
      taskId,
      startedAt: now,
      endedAt: null,
      actualMinutes: null,
      createdAt: now,
    });
    await this.patch('Task', `id=eq.${taskId}`, {
      status: 'in_progress',
      updatedAt: now,
    });
    return (await this.listTasks(userId, String(rows[0].date).slice(0, 10))).find(
      (t) => t.id === taskId,
    );
  }

  async stopTimer(userId: string, taskId: string) {
    const rows = await this.select<Record<string, unknown>>('Task', '*', {
      filter: `id=eq.${taskId}&userId=eq.${userId}`,
      limit: 1,
    });
    if (!rows[0]) throw new Error('Task not found');
    const entries = await this.select<Record<string, unknown>>('TimeEntry', '*', {
      filter: `taskId=eq.${taskId}`,
    });
    const active = entries.find((e) => !e.endedAt);
    if (!active) throw new Error('No active timer');
    const endedAt = new Date();
    const actualMinutes = elapsedMinutes(String(active.startedAt), endedAt);
    await this.patch('TimeEntry', `id=eq.${active.id}`, {
      endedAt: endedAt.toISOString(),
      actualMinutes,
    });
    const keepCompleted = String(rows[0].status) === 'completed';
    await this.patch('Task', `id=eq.${taskId}`, {
      status: keepCompleted ? 'completed' : 'pending',
      updatedAt: endedAt.toISOString(),
    });
    return (await this.listTasks(userId, String(rows[0].date).slice(0, 10))).find(
      (t) => t.id === taskId,
    );
  }

  /** Close open TimeEntries for a task (used by complete). */
  private async closeOpenEntriesForTask(taskId: string) {
    const entries = await this.select<{
      id: string;
      startedAt: string;
      endedAt: string | null;
    }>('TimeEntry', 'id,startedAt,endedAt', {
      filter: `taskId=eq.${taskId}`,
    });
    const now = new Date();
    for (const e of entries) {
      if (e.endedAt) continue;
      const actualMinutes = elapsedMinutes(String(e.startedAt), now);
      await this.patch('TimeEntry', `id=eq.${e.id}`, {
        endedAt: now.toISOString(),
        actualMinutes,
      });
    }
  }

  /** Stop every other open timer for this user so only one task can be Live. */
  private async stopOtherOpenTimers(userId: string, exceptTaskId: string) {
    const dayTasks = await this.select<{ id: string; status: string }>(
      'Task',
      'id,status',
      { filter: `userId=eq.${userId}` },
    );
    for (const t of dayTasks) {
      if (t.id === exceptTaskId) continue;
      const entries = await this.select<{
        id: string;
        startedAt: string;
        endedAt: string | null;
      }>('TimeEntry', 'id,startedAt,endedAt', {
        filter: `taskId=eq.${t.id}`,
      });
      const active = entries.find((e) => !e.endedAt);
      if (!active) continue;
      const endedAt = new Date();
      const actualMinutes = elapsedMinutes(String(active.startedAt), endedAt);
      await this.patch('TimeEntry', `id=eq.${active.id}`, {
        endedAt: endedAt.toISOString(),
        actualMinutes,
      });
      if (t.status !== 'completed') {
        await this.patch('Task', `id=eq.${t.id}`, {
          status: 'pending',
          updatedAt: endedAt.toISOString(),
        });
      }
    }
  }

  async listTasksInRange(userId: string, from: string, to: string) {
    const rows = await this.select<Record<string, unknown>>('Task', '*', {
      filter: `userId=eq.${userId}&date=gte.${from}&date=lte.${to}`,
      order: 'date.asc',
    });
    const out = [];
    for (const t of rows) {
      const entries = await this.select<Record<string, unknown>>(
        'TimeEntry',
        '*',
        { filter: `taskId=eq.${t.id}` },
      );
      out.push({ ...this.mapTaskRow(t, entries), _entries: entries });
    }
    return out;
  }

  private mapTaskRow(
    t: Record<string, unknown>,
    entries: Record<string, unknown>[],
  ) {
    const actualMinutes = entries.reduce(
      (sum, e) => sum + entryActualMinutes(e),
      0,
    );
    const active = entries.find((e) => !e.endedAt);
    const dateVal = t.date;
    const date =
      typeof dateVal === 'string'
        ? dateVal.slice(0, 10)
        : String(dateVal).slice(0, 10);
    return {
      id: String(t.id),
      date,
      name: String(t.name),
      estimatedMinutes: Number(t.estimatedMinutes),
      status: String(t.status) as 'pending' | 'in_progress' | 'completed',
      order: Number(t.order),
      scheduledStart: toUtcIso(
        t.scheduledStart != null ? String(t.scheduledStart) : null,
      ),
      scheduledEnd: toUtcIso(
        t.scheduledEnd != null ? String(t.scheduledEnd) : null,
      ),
      actualMinutes,
      activeEntryId: active ? String(active.id) : null,
      meetLink: t.meetLink ? String(t.meetLink) : null,
      scheduleLocked: Boolean(t.scheduleLocked),
      sourceProvider: t.sourceProvider ? String(t.sourceProvider) : null,
      notes: t.notes != null ? String(t.notes) : null,
      inBacklog: Boolean(t.inBacklog),
    };
  }
}
