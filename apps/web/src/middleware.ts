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

  const url = request.nextUrl.clone();
  url.protocol = 'https:';
  url.hostname = 'cupkey.io';
  url.port = '';

  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: '/',
};
