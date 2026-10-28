import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import type {
  AiBrandPlatform,
  StoredTaskAiPostDto,
} from '@timeblock/shared-types';

type StoreFile = {
  items: StoredTaskAiPostDto[];
};

function dataDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return resolve(tmpdir(), 'cupkey-data');
  }
  return resolve(__dirname, '../../data');
}

/**
 * Persists AI social drafts per task (local JSON — same pattern as AI credits).
 */
@Injectable()
export class TaskAiPostsStore {
  private readonly dir = dataDir();
  private readonly file = resolve(this.dir, 'task-ai-posts.json');

  private readFile(): StoreFile {
    if (!existsSync(this.file)) return { items: [] };
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      return { items: Array.isArray(raw.items) ? raw.items : [] };
    } catch {
      return { items: [] };
    }
  }

  private writeFile(data: StoreFile) {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn(
        '[task-ai-posts] write skipped',
        err instanceof Error ? err.message : err,
      );
    }
  }

  list(
    userId: string,
    opts?: { taskId?: string },
  ): StoredTaskAiPostDto[] {
    const taskId = opts?.taskId?.trim();
    return this.readFile()
      .items.filter((p) => {
        if (p.userId !== userId) return false;
        if (taskId && p.taskId !== taskId) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  save(input: {
    userId: string;
    taskId: string;
    taskName: string;
    platform: AiBrandPlatform;
    date: string;
    summary: string;
    notes: string;
    facts: StoredTaskAiPostDto['facts'];
  }): StoredTaskAiPostDto {
    const row: StoredTaskAiPostDto = {
      id: randomUUID(),
      userId: input.userId,
      taskId: input.taskId,
      taskName: input.taskName,
      platform: input.platform,
      date: input.date,
      summary: input.summary,
      notes: input.notes,
      createdAt: new Date().toISOString(),
      facts: input.facts,
    };
    const data = this.readFile();
    data.items.unshift(row);
    // Cap per user so the file stays lean
    const mine = data.items.filter((p) => p.userId === input.userId);
    if (mine.length > 200) {
      const drop = new Set(mine.slice(200).map((p) => p.id));
      data.items = data.items.filter((p) => !drop.has(p.id));
    }
    this.writeFile(data);
    return row;
  }

  update(
    userId: string,
    postId: string,
    summary: string,
  ): StoredTaskAiPostDto | null {
    const data = this.readFile();
    const idx = data.items.findIndex(
      (p) => p.id === postId && p.userId === userId,
    );
    if (idx < 0) return null;
    const next = {
      ...data.items[idx]!,
      summary: summary.trim(),
    };
    data.items[idx] = next;
    this.writeFile(data);
    return next;
  }

  delete(userId: string, postId: string): boolean {
    const data = this.readFile();
    const before = data.items.length;
    data.items = data.items.filter(
      (p) => !(p.id === postId && p.userId === userId),
    );
    if (data.items.length === before) return false;
    this.writeFile(data);
    return true;
  }
}
