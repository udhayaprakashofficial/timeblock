import { NextResponse } from 'next/server';
import type { AiBrandPlatform, AiTaskPostDto } from '@timeblock/shared-types';
import {
  buildTaskPrompt,
  generateWithGemini,
  loadTask,
  requireSessionUser,
  saveTaskPost,
} from '../../../../lib/ai-bff';
import { nestApiOrigin } from '../../../../lib/google-oauth-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Static route so Spotlight works even if a blanket `/api/:path*` rewrite
 * steals the dynamic `[...path]` catch-all (afterFiles runs before dynamics).
 */
export async function POST(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const bodyText = await req.text();

  // Prefer Nest when the API deploy has AI routes.
  try {
    const nest = await fetch(`${nestApiOrigin()}/api/ai/task-post`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: bodyText || '{}',
      cache: 'no-store',
    });
    const text = await nest.text();
    if (
      !(
        nest.status === 404 &&
        /Cannot POST\s+\/api\/ai\/task-post/i.test(text)
      )
    ) {
      return new NextResponse(text, {
        status: nest.status,
        headers: {
          'Content-Type':
            nest.headers.get('Content-Type') || 'application/json',
        },
      });
    }
  } catch {
    /* fall through to local Gemini BFF */
  }

  let user;
  try {
    user = await requireSessionUser(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { taskId?: string; platform?: string } = {};
  try {
    body = bodyText ? (JSON.parse(bodyText) as typeof body) : {};
  } catch {
    body = {};
  }

  const taskId = String(body.taskId ?? '').trim();
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }
  const platform: AiBrandPlatform = body.platform === 'x' ? 'x' : 'linkedin';

  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed';
    console.error('[api/ai/task-post]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
