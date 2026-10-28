import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_CREDITS_FREE_BUCKET,
  currentAiCreditsMonth,
  isActiveProUser,
} from './ai-credits';

type CreditRow = { month: string; used: number };

type StoreFile = {
  byUserId: Record<string, CreditRow>;
};

function dataDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return resolve(tmpdir(), 'cupkey-data');
  }
  return resolve(__dirname, '../../data');
}

/**
 * Persists AI credit usage.
 * Free → lifetime bucket (one-time 5).
 * Pro → UTC calendar month (50 / month, no carry-forward).
 */
@Injectable()
export class AiCreditsStore {
  private readonly dir = dataDir();
  private readonly file = resolve(this.dir, 'ai-credits.json');

  constructor(private readonly prisma: PrismaService) {}

  private readFile(): StoreFile {
    if (!existsSync(this.file)) return { byUserId: {} };
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      return { byUserId: raw.byUserId ?? {} };
    } catch {
      return { byUserId: {} };
    }
  }

  private writeFile(data: StoreFile) {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn(
        '[ai-credits] write skipped',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** Normalized usage for the user's current credit bucket. */
  async getUsage(
    userId: string,
    user?: { plan?: string | null; planStatus?: string | null },
  ): Promise<CreditRow> {
    const isPro = user ? isActiveProUser(user) : await this.lookupIsPro(userId);
    const month = isPro
      ? currentAiCreditsMonth()
      : AI_CREDITS_FREE_BUCKET;
    const fromFile = this.readFile().byUserId[userId];
    if (fromFile?.month === month) {
      return { month, used: Math.max(0, Number(fromFile.used) || 0) };
    }

    // Free lifetime: keep prior lifetime usage if stored under that key
    if (
      !isPro &&
      fromFile?.month === AI_CREDITS_FREE_BUCKET
    ) {
      return {
        month: AI_CREDITS_FREE_BUCKET,
        used: Math.max(0, Number(fromFile.used) || 0),
      };
    }

    if (!userId.startsWith('local_')) {
      try {
        const row = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { aiCreditsUsed: true, aiCreditsMonth: true },
        });
        if (row) {
          if (row.aiCreditsMonth === month) {
            const used = Math.max(0, row.aiCreditsUsed || 0);
            this.persistFile(userId, { month, used });
            return { month, used };
          }
          // New Pro month — reset. Free lifetime never resets here.
          if (isPro) {
            await this.prisma.user
              .update({
                where: { id: userId },
                data: { aiCreditsUsed: 0, aiCreditsMonth: month },
              })
              .catch(() => null);
            this.persistFile(userId, { month, used: 0 });
            return { month, used: 0 };
          }
          // Migrating free user: prefer DB if it was already lifetime
          if (row.aiCreditsMonth === AI_CREDITS_FREE_BUCKET) {
            const used = Math.max(0, row.aiCreditsUsed || 0);
            this.persistFile(userId, { month, used });
            return { month, used };
          }
        }
      } catch {
        /* column missing or DB down — file only */
      }
    }

    this.persistFile(userId, { month, used: 0 });
    return { month, used: 0 };
  }

  async consume(
    userId: string,
    user?: { plan?: string | null; planStatus?: string | null },
  ): Promise<CreditRow> {
    const cur = await this.getUsage(userId, user);
    const next = { month: cur.month, used: cur.used + 1 };
    this.persistFile(userId, next);

    if (!userId.startsWith('local_')) {
      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            aiCreditsUsed: next.used,
            aiCreditsMonth: next.month,
          },
        });
      } catch {
        /* ignore — file is source of truth overlay */
      }
    }
    return next;
  }

  private async lookupIsPro(userId: string): Promise<boolean> {
    try {
      const row = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true, planStatus: true },
      });
      if (row) return isActiveProUser(row);
    } catch {
      /* ignore */
    }
    return false;
  }

  private persistFile(userId: string, row: CreditRow) {
    const db = this.readFile();
    db.byUserId[userId] = row;
    this.writeFile(db);
  }
}
