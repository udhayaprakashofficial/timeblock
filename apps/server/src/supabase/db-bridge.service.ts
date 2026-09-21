import { Injectable, Logger } from '@nestjs/common';
import { LocalUserStore } from '../auth/local-user.store';
import { LocalDataStore } from '../auth/local-data.store';
import { CryptoService } from '../crypto/crypto.service';
import { SupabaseRestService } from './supabase-rest.service';
import { createId } from './create-id';

/**
 * Routes app data to Supabase DB when keys are configured.
 * Maps offline `local_*` session users onto real User rows and migrates JSON data.
 */
@Injectable()
export class DbBridgeService {
  private readonly logger = new Logger(DbBridgeService.name);
  private readonly mapped = new Map<string, string>();
  private readonly migrated = new Set<string>();

  constructor(
    private readonly supabase: SupabaseRestService,
    private readonly localUsers: LocalUserStore,
    private readonly localData: LocalDataStore,
    private readonly crypto: CryptoService,
  ) {}

  /** True when APIs must use the database (HTTPS REST) and it is reachable. */
  useDb() {
    return this.supabase.isConfigured() && this.supabase.isReady();
  }

  /**
   * Resolve session userId to a Supabase User.id.
   * Migrates local file users + their tasks/schedules into the DB once.
   */
  async resolveUserId(userId: string): Promise<string> {
    if (!userId.startsWith('local_')) return userId;
    const cached = this.mapped.get(userId);
    if (cached) return cached;

    if (!this.useDb()) return userId;

    const local = this.localUsers.findById(userId);
    if (!local?.email) {
      throw new Error(`Unknown local user ${userId}`);
    }

    await this.supabase.ping();
    const dbUser = await this.supabase.upsertGoogleUser({
      email: local.email,
      name: local.name,
      googleId: local.googleId || `local-${local.id}`,
      accessTokenEncrypted: this.crypto.encrypt(
        local.accessToken || 'local-placeholder-token',
      ),
      refreshTokenEncrypted: local.refreshToken
        ? this.crypto.encrypt(local.refreshToken)
        : null,
    });

    this.mapped.set(userId, dbUser.id);
    await this.migrateLocalData(userId, dbUser.id);
    this.logger.log(`Mapped ${userId} → DB user ${dbUser.id} (${local.email})`);
    return dbUser.id;
  }

  private async migrateLocalData(localUserId: string, dbUserId: string) {
    if (this.migrated.has(localUserId)) return;
    this.migrated.add(localUserId);

    try {
      const schedules = this.localData.listSchedule(localUserId);
      const existing = await this.supabase.listSchedule(dbUserId);
      if (!existing.length && schedules.length) {
        for (const s of schedules) {
          await this.supabase.upsertSchedule(dbUserId, {
            weekday: s.weekday,
            workStart: s.workStart,
            workEnd: s.workEnd,
            breaks: s.breaks.map((b) => ({
              name: b.name,
              start: b.start,
              end: b.end,
            })),
          });
        }
        this.logger.log(`Migrated ${schedules.length} schedule rows → DB`);
      }

      // Pull tasks from the local JSON file for this user
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');
      const file = resolve(__dirname, '../../data/local-app.json');
      if (!existsSync(file)) return;
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        tasks?: Array<{
          id: string;
          userId: string;
          date: string;
          name: string;
          estimatedMinutes: number;
          status: string;
          order: number;
          scheduledStart: string | null;
          scheduledEnd: string | null;
        }>;
      };
      const tasks = (raw.tasks ?? []).filter((t) => t.userId === localUserId);
      if (!tasks.length) return;

      let copied = 0;
      for (const t of tasks) {
        const found = await this.supabase.select('Task', 'id', {
          filter: `userId=eq.${dbUserId}&date=eq.${t.date}&name=eq.${encodeURIComponent(t.name)}`,
          limit: 1,
        });
        if (found.length) continue;
        const now = new Date().toISOString();
        await this.supabase.insert('Task', {
          id: createId(),
          userId: dbUserId,
          date: t.date,
          name: t.name,
          estimatedMinutes: t.estimatedMinutes,
          status: t.status,
          order: t.order,
          scheduledStart: t.scheduledStart,
          scheduledEnd: t.scheduledEnd,
          createdAt: now,
          updatedAt: now,
        });
        copied += 1;
      }
      if (copied) this.logger.log(`Migrated ${copied} tasks → DB`);
    } catch (err) {
      this.logger.warn(
        `Local→DB migrate partial: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
