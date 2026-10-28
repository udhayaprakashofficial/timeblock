import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import type {
  AiCareerSummaryScope,
  AiHomerInterviewFormat,
  HomerEvidenceItemDto,
  StoredHomerGenerationDto,
} from '@timeblock/shared-types';

type StoreFile = {
  items: StoredHomerGenerationDto[];
};

function dataDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return resolve(tmpdir(), 'cupkey-data');
  }
  return resolve(__dirname, '../../data');
}

function normProject(p: string | null | undefined): string {
  return (p ?? '').trim().toLowerCase();
}

function normFormat(
  mode: 'appraisal' | 'interview',
  format: AiHomerInterviewFormat | null | undefined,
): AiHomerInterviewFormat | null {
  if (mode !== 'interview') return null;
  if (format === '30s' || format === '60s' || format === 'star') return format;
  return '60s';
}

/** Normalize AI titles without inventing content. */
export function normalizeHomerHeadline(raw: string, fallback: string): string {
  let t = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'“”]+|["'“”]+$/g, '');
  if (!t) t = fallback;
  // Title-ish: keep short
  if (t.length > 80) t = t.slice(0, 77).trimEnd() + '…';
  return t;
}

function normalizeRow(raw: StoredHomerGenerationDto): StoredHomerGenerationDto {
  return {
    ...raw,
    format: normFormat(raw.mode, raw.format),
    gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    version: typeof raw.version === 'number' ? raw.version : 1,
    updatedAt: raw.updatedAt ?? null,
    replacesId: raw.replacesId ?? null,
  };
}

/** Persists Homer appraisal / interview write-ups (local JSON). */
@Injectable()
export class HomerGenerationsStore {
  private readonly dir = dataDir();
  private readonly file = resolve(this.dir, 'homer-generations.json');

  private readFile(): StoreFile {
    if (!existsSync(this.file)) return { items: [] };
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      const items = Array.isArray(raw.items)
        ? raw.items.map((r) => normalizeRow(r))
        : [];
      return { items };
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
        '[homer-generations] write skipped',
        err instanceof Error ? err.message : err,
      );
    }
  }

  list(
    userId: string,
    opts?: { mode?: 'appraisal' | 'interview' },
  ): StoredHomerGenerationDto[] {
    const mode = opts?.mode;
    return this.readFile()
      .items.filter((p) => {
        if (p.userId !== userId) return false;
        if (mode && p.mode !== mode) return false;
        return true;
      })
      .sort((a, b) =>
        (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
      );
  }

  findDuplicate(input: {
    userId: string;
    mode: 'appraisal' | 'interview';
    format?: AiHomerInterviewFormat | null;
    from: string;
    to: string;
    scope: AiCareerSummaryScope;
    project: string | null;
  }): StoredHomerGenerationDto | null {
    const format = normFormat(input.mode, input.format);
    const project = normProject(input.project);
    const match = this.readFile().items.find((p) => {
      if (p.userId !== input.userId) return false;
      if (p.mode !== input.mode) return false;
      if (normFormat(p.mode, p.format) !== format) return false;
      if (p.from !== input.from || p.to !== input.to) return false;
      if (p.scope !== input.scope) return false;
      if (normProject(p.project) !== project) return false;
      return true;
    });
    return match ?? null;
  }

  get(userId: string, id: string): StoredHomerGenerationDto | null {
    return (
      this.readFile().items.find((p) => p.id === id && p.userId === userId) ??
      null
    );
  }

  save(
    input: Omit<
      StoredHomerGenerationDto,
      'id' | 'createdAt' | 'updatedAt' | 'version'
    > & { version?: number; replacesId?: string | null },
  ): StoredHomerGenerationDto {
    const now = new Date().toISOString();
    const row: StoredHomerGenerationDto = normalizeRow({
      ...input,
      id: randomUUID(),
      format: normFormat(input.mode, input.format),
      gaps: input.gaps ?? [],
      evidence: (input.evidence ?? []) as HomerEvidenceItemDto[],
      createdAt: now,
      updatedAt: now,
      version: input.version ?? 1,
      replacesId: input.replacesId ?? null,
    });
    const data = this.readFile();
    data.items.unshift(row);
    const mine = data.items.filter((p) => p.userId === input.userId);
    if (mine.length > 100) {
      const drop = new Set(mine.slice(100).map((p) => p.id));
      data.items = data.items.filter((p) => !drop.has(p.id));
    }
    this.writeFile(data);
    return row;
  }

  update(
    userId: string,
    id: string,
    patch: Partial<
      Pick<
        StoredHomerGenerationDto,
        | 'headline'
        | 'summary'
        | 'responsibilities'
        | 'projects'
        | 'achievements'
        | 'tip'
        | 'gaps'
        | 'evidence'
        | 'taskCount'
        | 'format'
      >
    >,
  ): StoredHomerGenerationDto | null {
    const data = this.readFile();
    const idx = data.items.findIndex((p) => p.id === id && p.userId === userId);
    if (idx < 0) return null;
    const prev = normalizeRow(data.items[idx]!);
    const next = normalizeRow({
      ...prev,
      ...patch,
      format: normFormat(
        prev.mode,
        patch.format !== undefined ? patch.format : prev.format,
      ),
      updatedAt: new Date().toISOString(),
      version: (prev.version ?? 1) + 1,
    });
    data.items[idx] = next;
    this.writeFile(data);
    return next;
  }

  delete(userId: string, id: string): boolean {
    const data = this.readFile();
    const before = data.items.length;
    data.items = data.items.filter(
      (p) => !(p.id === id && p.userId === userId),
    );
    if (data.items.length === before) return false;
    this.writeFile(data);
    return true;
  }
}
