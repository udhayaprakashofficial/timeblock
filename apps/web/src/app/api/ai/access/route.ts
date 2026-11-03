import { NextResponse } from 'next/server';
import { buildAccessDto, requireSessionUser } from '../../../../lib/ai-bff';
import { nestApiOrigin } from '../../../../lib/google-oauth-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dedicated AI credits endpoint for the sidebar badge.
 * Prefer Nest when it has /api/ai/access; otherwise serve the BFF stub so
 * production still shows the meter while the API deploy is stale.
 */
export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';

  try {
    const nest = await fetch(`${nestApiOrigin()}/api/ai/access`, {
      headers: {
        Accept: 'application/json',
        Cookie: cookie,
      },
      cache: 'no-store',
    });
    if (nest.ok) {
      const body = await nest.text();
      return new NextResponse(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    /* Nest down / missing route — fall through */
  }

  try {
    const user = await requireSessionUser(req);
    return NextResponse.json(buildAccessDto(user));
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
