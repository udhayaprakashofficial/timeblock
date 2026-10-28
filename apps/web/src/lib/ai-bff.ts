import { randomUUID } from 'crypto';
import type {
  AiAccessDto,
  AiBrandPlatform,
  StoredTaskAiPostDto,
  UserDto,
} from '@timeblock/shared-types';
import { nestApiOrigin } from './google-oauth-bff';

type StoreFile = { items: StoredTaskAiPostDto[] };

const g = globalThis as typeof globalThis & {
  __cupkeyTaskAiPosts?: StoreFile;
};

function store(): StoreFile {
  if (!g.__cupkeyTaskAiPosts) g.__cupkeyTaskAiPosts = { items: [] };
  return g.__cupkeyTaskAiPosts;
}

export async function requireSessionUser(req: Request): Promise<UserDto> {
  const cookie = req.headers.get('cookie') ?? '';
  const res = await fetch(`${nestApiOrigin()}/api/users/me`, {
    headers: {
      Accept: 'application/json',
      Cookie: cookie,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return (await res.json()) as UserDto;
}

export function listTaskPosts(
  userId: string,
  taskId?: string,
): StoredTaskAiPostDto[] {
  const tid = taskId?.trim();
  return store()
    .items.filter((p) => {
      if (p.userId !== userId) return false;
      if (tid && p.taskId !== tid) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveTaskPost(input: {
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
  const data = store();
  data.items.unshift(row);
  const mine = data.items.filter((p) => p.userId === input.userId);
  if (mine.length > 200) {
    const drop = new Set(mine.slice(200).map((p) => p.id));
    data.items = data.items.filter((p) => !drop.has(p.id));
  }
  return row;
}

export function updateTaskPost(
  userId: string,
  postId: string,
  summary: string,
): StoredTaskAiPostDto | null {
  const data = store();
  const idx = data.items.findIndex(
    (p) => p.id === postId && p.userId === userId,
  );
  if (idx < 0) return null;
  const next = { ...data.items[idx]!, summary: summary.trim() };
  data.items[idx] = next;
  return next;
}

export function deleteTaskPost(userId: string, postId: string): boolean {
  const data = store();
  const before = data.items.length;
  data.items = data.items.filter(
    (p) => !(p.id === postId && p.userId === userId),
  );
  return data.items.length < before;
}

export function buildAccessDto(user: UserDto): AiAccessDto {
  const isPro =
    user.plan === 'pro' &&
    (user.planStatus === 'active' ||
      user.planStatus === 'trialing' ||
      !user.planStatus);
  const limit = isPro ? 50 : 5;
  return {
    enabled: true,
    requirePro: true,
    hasAccess: true,
    reason: null,
    creditsRemaining: limit,
    creditsLimit: limit,
    creditsUsed: 0,
    creditsMonth: isPro
      ? new Date().toISOString().slice(0, 7)
      : 'lifetime',
    isPro,
    refillLabel: isPro ? 'next month' : 'when you upgrade to Pro',
    freeCreditsMonthly: 5,
    proCreditsMonthly: 50,
  };
}

type TaskRow = {
  id: string;
  name: string;
  date: string;
  notes?: string | null;
  estimatedMinutes?: number;
  actualMinutes?: number;
  status?: string;
};

export async function loadTask(
  req: Request,
  taskId: string,
): Promise<TaskRow | null> {
  const cookie = req.headers.get('cookie') ?? '';
  // Try history window then today list
  const urls = [
    `${nestApiOrigin()}/api/tasks?from=2020-01-01&to=2099-12-31`,
    `${nestApiOrigin()}/api/tasks`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', Cookie: cookie },
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const data = (await res.json()) as TaskRow[] | { tasks?: TaskRow[] };
      const list = Array.isArray(data) ? data : (data.tasks ?? []);
      const hit = list.find((t) => t.id === taskId);
      if (hit) return hit;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function generateWithGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set on the web app. Add it in Vercel env for the web project.',
    );
  }
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Gemini error ${res.status}`);
  }
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => String(p.text ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

export function buildTaskPrompt(
  platform: AiBrandPlatform,
  task: TaskRow,
  notes: string,
): string {
  const platformLabel = platform === 'x' ? 'X' : 'LinkedIn';
  const platformRules =
    platform === 'x'
      ? `Platform rules for X: keep it under ~260 characters. Same tone — short and human. Still no hashtags, no CTA, no audience question.`
      : `Platform rules for LinkedIn: 60 to 120 words. Short paragraphs. Same casual first-person tone — not a brand voice.`;
  const actual = Number(task.actualMinutes) || 0;
  const timeHint =
    actual >= 30
      ? `Time spent: about ${actual} minutes. You may mention this loosely.`
      : `Do not mention how long it took.`;
  const tenseHint =
    task.status === 'completed'
      ? 'Write about it as finished.'
      : 'Write about it as ongoing work ("working on", "been figuring out").';

  return `You write casual, first-person social posts for a working professional to share on ${platformLabel}. The post is about the SUBJECT of their work, not a report of the task.

Here is what they worked on:
Task: ${task.name}
${timeHint}
Notes (raw, may contain typos and timestamps):
"""
${notes.slice(0, 4000)}
"""

How to write it:
1. Open with a genuine observation or opinion about the topic behind the task. Something a peer would nod at. Not a hook, not a slogan.
2. Then connect it to what they are working on, loosely and naturally ("I just spent...", "Been working on..."). ${tenseHint}
3. Optionally close with a human note: credit someone who helped, a small realization, or what is next. Only if the notes support it.

Tone:
• Sounds like a real person typing on their phone, not a brand or a coach.
• Plain words, short paragraphs, slightly informal is fine.
• 60 to 120 words.

Never:
• Mention minutes, hours, timestamps, status, "planned" or "logged" unless given in the time hint above.
• End with a question to the audience, a call to action, or hashtags.
• Use slogans or LinkedIn clichés.
• Mention AI tools by product name, "Cupkey", or that the post was generated.
• Invent results, numbers, or work not in the notes.

${platformRules}

Return only the post text.`;
}
