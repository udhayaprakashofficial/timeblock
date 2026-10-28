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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

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
  const url = new URL(req.url);

  try {
    if (head === 'access' && method === 'GET') {
      return NextResponse.json(buildAccessDto(user));
    }

    if (head === 'task-posts' && method === 'GET' && !id) {
      const taskId = url.searchParams.get('taskId') ?? undefined;
      return NextResponse.json({
        items: listTaskPosts(user.id, taskId),
      });
    }

    if (head === 'task-posts' && id && method === 'PATCH') {
      const body = (await req.json().catch(() => ({}))) as {
        summary?: string;
      };
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
      const body = (await req.json().catch(() => ({}))) as {
        taskId?: string;
        platform?: string;
      };
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

    if (head === 'homer-generations' && method === 'GET') {
      return NextResponse.json({ items: [] });
    }

    if (head === 'homer-generations' && method === 'POST') {
      return NextResponse.json(
        { error: 'Homer AI requires the API server redeploy. Try again soon.' },
        { status: 503 },
      );
    }

    if (head === 'homer-generations' && id && method === 'DELETE') {
      return NextResponse.json({ ok: true });
    }

    // Other AI tools (coach, estimate, …) — soft unavailable until Nest redeploys
    if (
      [
        'brand-summary',
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
      if (head === 'brand-summary') {
        // brand-summary is close to task-post; keep a clear error for now
      }
      return NextResponse.json(
        {
          error:
            'This AI feature is updating. Redeploy timeblock-server on Vercel, or try Spotlight task posts.',
        },
        { status: 503 },
      );
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
