import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Marketing lives on cupkey.io; app.cupkey.io only serves the signed-in product. */
const APP_HOST = 'app.cupkey.io';
const MARKETING_ORIGIN = 'https://cupkey.io';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase() ?? '';
  if (host !== APP_HOST) {
    return NextResponse.next();
  }

  const { searchParams } = request.nextUrl;

  // OAuth handoff must stay on the app host. Nest (and older builds) redirect to
  // `/?loginCode=` or `/?authError=` — without this, middleware 308s those to
  // cupkey.io and Google "success" looks like a hard failure on marketing.
  if (searchParams.has('loginCode')) {
    const url = request.nextUrl.clone();
    url.pathname = '/schedule';
    return NextResponse.redirect(url, 307);
  }
  if (searchParams.has('authError')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url, 307);
  }

  const url = request.nextUrl.clone();
  url.protocol = 'https:';
  url.hostname = 'cupkey.io';
  url.port = '';

  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: '/',
};
