import { NextResponse } from 'next/server';
import {
  OAUTH_STATE_COOKIE,
  appOriginFromRequest,
  encodeOAuthCookie,
  googleCallbackUrl,
  googleClientConfig,
  hashState,
  newOAuthState,
  safeReturnPath,
} from '../../../../lib/google-oauth-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Google sign-in / calendar connect — handled in Next so production login
 * does not depend on a stale Nest OAuth build (gmail/calendar scopes +
 * in-memory login codes).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const appOrigin = appOriginFromRequest(req);
  const client = googleClientConfig();
  if (!client) {
    return NextResponse.redirect(
      `${appOrigin}/login?authError=google_not_configured`,
    );
  }

  const intent = url.searchParams.get('intent');
  const returnTo = safeReturnPath(url.searchParams.get('returnTo'));
  const wantCalendar =
    intent === 'calendar' || returnTo.includes('/settings');

  const state = newOAuthState();
  const callbackURL = googleCallbackUrl(appOrigin);
  const scope = wantCalendar
    ? [
        'email',
        'profile',
        'openid',
        'https://www.googleapis.com/auth/calendar.readonly',
      ]
    : ['email', 'profile', 'openid'];

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', client.id);
  auth.searchParams.set('redirect_uri', callbackURL);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', scope.join(' '));
  auth.searchParams.set('access_type', 'offline');
  auth.searchParams.set('include_granted_scopes', 'true');
  auth.searchParams.set('state', state);
  auth.searchParams.set('prompt', wantCalendar ? 'consent' : 'select_account');

  const res = NextResponse.redirect(auth.toString());
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: encodeOAuthCookie({
      s: hashState(state),
      r: returnTo,
      c: wantCalendar,
    }),
    httpOnly: true,
    secure: appOrigin.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
