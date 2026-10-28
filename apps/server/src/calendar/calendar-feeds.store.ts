import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

type StoreFile = {
  byUserId: Record<string, { icsUrl: string; updatedAt: string }>;
};

function dataDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return resolve(tmpdir(), 'cupkey-data');
  }
  return resolve(__dirname, '../../data');
}

/** Private Google iCal feed URLs — works without Google OAuth verification / Test users. */
@Injectable()
export class CalendarFeedsStore {
  private readonly dir = dataDir();
  private readonly file = resolve(this.dir, 'calendar-feeds.json');

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
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
  }

  get(userId: string): string | null {
    const url = this.readFile().byUserId[userId]?.icsUrl?.trim();
    return url || null;
  }

  /** All feeds for cron sync. */
  all(): Array<{ userId: string; icsUrl: string }> {
    return Object.entries(this.readFile().byUserId).map(([userId, row]) => ({
      userId,
      icsUrl: row.icsUrl,
    }));
  }

  set(userId: string, icsUrl: string) {
    const data = this.readFile();
    data.byUserId[userId] = {
      icsUrl: icsUrl.trim(),
      updatedAt: new Date().toISOString(),
    };
    this.writeFile(data);
  }

  clear(userId: string) {
    const data = this.readFile();
    if (!data.byUserId[userId]) return;
    delete data.byUserId[userId];
    this.writeFile(data);
  }
}
