import { NextResponse } from 'next/server';
import type { AiBrandPlatform, AiTaskPostDto } from '@timeblock/shared-types';
import {
  buildAccessDto,
  buildTaskPrompt,
  deleteTaskPost,
  generateWithGemini,
  listTaskPosts,
  loadTask,
  requireSessionUser,
  saveTaskPost,
  updateTaskPost,
} from '../../../../lib/ai-bff';
import { nestApiOrigin } from '../../../../lib/google-oauth-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

function isNestMissingRoute(status: number, body: string): boolean {
  if (status !== 404) return false;
  return /Cannot (GET|POST|PATCH|PUT|DELETE)\s+\/api\/ai/i.test(body);
}

/**
 * Prefer live Nest AI when the API deploy has the routes; otherwise null so
 * the local BFF can serve Spotlight / hub tools while Nest is stale.
 */
async function tryNestAi(
  req: Request,
  subPath: string,
  bodyText: string | null,
): Promise<Response | null> {
  const cookie = req.headers.get('cookie') ?? '';
  const incoming = new URL(req.url);
  const target = `${nestApiOrigin()}/api/ai/${subPath}${incoming.search}`;
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Cookie: cookie,
    };
    if (bodyText !== null) headers['Content-Type'] = 'application/json';
    const nest = await fetch(target, {
      method: req.method,
      headers,
      body: bodyText,
      cache: 'no-store',
    });
    const text = await nest.text();
    if (isNestMissingRoute(nest.status, text)) return null;
    return new NextResponse(text, {
      status: nest.status,
      headers: {
        'Content-Type': nest.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch {
    return null;
  }
}

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  let user;
  try {
    user = await requireSessionUser(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { path } = await ctx.params;
  const segments = path ?? [];
  const head = segments[0] ?? '';
  const id = segments[1];
  const method = req.method.toUpperCase();
  const subPath = segments.map(encodeURIComponent).join('/');
  const bodyText =
    method === 'GET' || method === 'HEAD' ? null : await req.text();

  // Nest-first: when timeblock-server is current, use it.
  if (subPath) {
    const nestRes = await tryNestAi(req, subPath, bodyText);
    if (nestRes) return nestRes;
  }

  const parseBody = <T,>(): T => {
    if (!bodyText) return {} as T;
    try {
      return JSON.parse(bodyText) as T;
    } catch {
      return {} as T;
    }
  };

  try {
    if (head === 'access' && method === 'GET') {
      return NextResponse.json(buildAccessDto(user));
    }

    if (head === 'task-posts' && method === 'GET' && !id) {
      const url = new URL(req.url);
      const taskId = url.searchParams.get('taskId') ?? undefined;
      return NextResponse.json({
        items: listTaskPosts(user.id, taskId),
      });
    }

    if (head === 'task-posts' && id && method === 'PATCH') {
      const body = parseBody<{ summary?: string }>();
      const summary = String(body.summary ?? '').trim();
      if (!summary) {
        return NextResponse.json(
          { error: 'summary is required' },
          { status: 400 },
        );
      }
      const updated = updateTaskPost(user.id, id, summary);
      if (!updated) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      return NextResponse.json(updated);
    }

    if (head === 'task-posts' && id && method === 'DELETE') {
      if (!deleteTaskPost(user.id, id)) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    if (head === 'task-post' && method === 'POST') {
      const body = parseBody<{ taskId?: string; platform?: string }>();
      const taskId = String(body.taskId ?? '').trim();
      if (!taskId) {
        return NextResponse.json(
          { error: 'taskId is required' },
          { status: 400 },
        );
      }
      const platform: AiBrandPlatform =
        body.platform === 'x' ? 'x' : 'linkedin';
      const task = await loadTask(req, taskId);
      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      const notes = String(task.notes ?? '').trim();
      if (!notes) {
        return NextResponse.json(
          {
            error:
              'Add notes or comments on this task before generating a social post.',
          },
          { status: 400 },
        );
      }
      const summary = await generateWithGemini(
        buildTaskPrompt(platform, task, notes),
      );
      const facts = {
        estimatedMinutes: Number(task.estimatedMinutes) || 0,
        actualMinutes: Number(task.actualMinutes) || 0,
        status: String(task.status ?? 'pending'),
      };
      const saved = saveTaskPost({
        userId: user.id,
        taskId: task.id,
        taskName: task.name,
        platform,
        date: task.date,
        summary,
        notes,
        facts,
      });
      const dto: AiTaskPostDto = {
        id: saved.id,
        createdAt: saved.createdAt,
        taskId: task.id,
        taskName: task.name,
        platform,
        date: task.date,
        summary,
        notes,
        facts,
      };
      return NextResponse.json(dto);
    }

    if (head === 'brand-summary' && method === 'POST') {
      const body = parseBody<{
        date?: string;
        range?: string;
        platform?: string;
      }>();
      const date = String(body.date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json(
          { error: 'date must be YYYY-MM-DD' },
          { status: 400 },
        );
      }
      const platform: AiBrandPlatform =
        body.platform === 'x' ? 'x' : 'linkedin';
      const range = ['today', 'day', 'week', 'month', 'year'].includes(
        String(body.range ?? ''),
      )
        ? String(body.range)
        : 'week';
      const platformLabel = platform === 'x' ? 'X' : 'LinkedIn';
      const summary = await generateWithGemini(
        `Write a short first-person ${platformLabel} post summarizing productive work around ${date} (${range}). Casual, no hashtags, no CTA, no AI mention. 60-120 words for LinkedIn, under 260 chars for X. Return only the post text.`,
      );
      return NextResponse.json({
        range,
        platform,
        from: date,
        to: date,
        label: `${range} (${date})`,
        summary,
        facts: {
          totalTasks: 0,
          completed: 0,
          pending: 0,
          estimatedMinutes: 0,
          actualMinutes: 0,
          completionPercent: 0,
          topTasks: [],
        },
      });
    }

    if (head === 'homer-generations' && method === 'GET') {
      return NextResponse.json({ items: [] });
    }

    if (head === 'homer-generations' && method === 'POST') {
      return NextResponse.json(
        {
          error:
            'Homer AI needs the API server. Redeploy timeblock-server, then try again.',
        },
        { status: 503 },
      );
    }

    if (head === 'homer-generations' && id && method === 'DELETE') {
      return NextResponse.json({ ok: true });
    }

    // Lightweight Gemini fallbacks for AiHub tools while Nest AI is stale.
    if (
      [
        'career-summary',
        'daily-plan',
        'brain-dump',
        'estimate',
        'prioritize',
        'recover',
        'coach',
        'focus',
      ].includes(head) &&
      method === 'POST'
    ) {
      const body = parseBody<Record<string, unknown>>();
      const text = await generateWithGemini(
        `You are Cupkey's work coach. Feature: ${head}. Input JSON:\n${JSON.stringify(body).slice(0, 6000)}\nRespond with concise, practical advice in plain text (no markdown fences).`,
      );
      const date = String(body.date ?? '');
      if (head === 'estimate') {
        return NextResponse.json({
          name: String(body.name ?? ''),
          estimatedMinutes: 30,
          rationale: text,
        });
      }
      if (head === 'daily-plan') {
        return NextResponse.json({
          date,
          summary: text,
          proposedTasks: [],
          requiresApproval: true,
        });
      }
      if (head === 'brain-dump') {
        return NextResponse.json({
          date,
          proposedTasks: [],
          requiresApproval: true,
        });
      }
      if (head === 'prioritize') {
        return NextResponse.json({
          date,
          orderedTaskIds: [],
          rationale: text,
          requiresApproval: true,
        });
      }
      if (head === 'recover') {
        return NextResponse.json({
          date,
          summary: text,
          moves: [],
          requiresApproval: true,
        });
      }
      if (head === 'coach') {
        return NextResponse.json({
          date,
          title: 'Coach note',
          body: text,
          tips: [],
        });
      }
      if (head === 'focus') {
        return NextResponse.json({
          date,
          taskId: (body.taskId as string | undefined) ?? null,
          taskName: null,
          message: text,
          suggestion: text.slice(0, 280),
        });
      }
      if (head === 'career-summary') {
        return NextResponse.json({
          from: String(body.from ?? date),
          to: String(body.to ?? date),
          query: String(body.query ?? ''),
          scope: body.scope ?? 'range',
          project: null,
          mode: body.mode ?? 'weekly',
          format: body.format ?? null,
          headline: 'Work summary',
          summary: text,
          responsibilities: [],
          projects: [],
          achievements: [],
          tip: null,
          gaps: [
            'Full Homer AI needs the API server redeploy for richer evidence.',
          ],
          evidence: [],
          taskCount: 0,
        });
      }
    }

    return NextResponse.json(
      { error: `Unknown AI route: ${segments.join('/')}` },
      { status: 404 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed';
    console.error('[api/ai]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
