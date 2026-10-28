import { NextResponse } from 'next/server';
import {
  OAUTH_STATE_COOKIE,
  appOriginFromRequest,
  decodeOAuthCookie,
  googleCallbackUrl,
  googleClientConfig,
  hashState,
  nestApiOrigin,
  safeReturnPath,
} from '../../../../../lib/google-oauth-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  id?: string;
  email?: string;
  name?: string;
  verified_email?: boolean;
};

function clearOAuthCookie(res: NextResponse, secure: boolean) {
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

function failRedirect(appOrigin: string, reason: string, returnPath: string) {
  const failPath = returnPath.startsWith('/settings') ? returnPath : '/login';
  const sep = failPath.includes('?') ? '&' : '?';
  const res = NextResponse.redirect(
    `${appOrigin}${failPath}${sep}authError=${encodeURIComponent(reason)}`,
  );
  clearOAuthCookie(res, appOrigin.startsWith('https'));
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appOrigin = appOriginFromRequest(req);
  const secure = appOrigin.startsWith('https');
  const cookieHeader = req.headers.get('cookie') ?? '';
  const rawCookie = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);
  const saved = decodeOAuthCookie(rawCookie);
  const returnPath = safeReturnPath(saved?.r);

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    console.error('[auth/google] google returned error', oauthError);
    return failRedirect(appOrigin, 'google', returnPath);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !saved || hashState(state) !== saved.s) {
    console.error('[auth/google] missing/invalid state or code');
    return failRedirect(appOrigin, 'google', returnPath);
  }

  const client = googleClientConfig();
  if (!client) {
    return failRedirect(appOrigin, 'google_not_configured', returnPath);
  }

  const callbackURL = googleCallbackUrl(appOrigin);
  let tokens: GoogleTokenResponse;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: callbackURL,
        grant_type: 'authorization_code',
      }),
    });
    tokens = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokenRes.ok || !tokens.access_token) {
      console.error(
        '[auth/google] token exchange failed',
        tokens.error || tokens.error_description || tokenRes.status,
      );
      return failRedirect(appOrigin, 'google_token', returnPath);
    }
  } catch (e) {
    console.error('[auth/google] token exchange error', e);
    return failRedirect(appOrigin, 'google_token', returnPath);
  }

  let profile: GoogleUserInfo;
  try {
    const profileRes = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    profile = (await profileRes.json()) as GoogleUserInfo;
    if (!profileRes.ok || !profile.email || !profile.id) {
      console.error('[auth/google] userinfo failed', profile);
      return failRedirect(appOrigin, 'google', returnPath);
    }
  } catch (e) {
    console.error('[auth/google] userinfo error', e);
    return failRedirect(appOrigin, 'google', returnPath);
  }

  // Nest loginWithGoogleBrowser prefers Supabase REST — works on Vercel.
  let nestRes: Response;
  try {
    nestRes = await fetch(`${nestApiOrigin()}/api/auth/google/browser`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        email: profile.email,
        name: profile.name || profile.email,
        googleId: profile.id,
      }),
    });
  } catch (e) {
    console.error('[auth/google] nest browser login failed', e);
    return failRedirect(appOrigin, 'google', returnPath);
  }

  if (!nestRes.ok) {
    const body = await nestRes.text().catch(() => '');
    console.error('[auth/google] nest browser login', nestRes.status, body);
    return failRedirect(appOrigin, 'google', returnPath);
  }

  const res = NextResponse.redirect(`${appOrigin}${returnPath}`);
  clearOAuthCookie(res, secure);

  const getSetCookie = (
    nestRes.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  if (getSetCookie?.length) {
    for (const c of getSetCookie) {
      res.headers.append('Set-Cookie', rewriteCookieForAppHost(c));
    }
  } else {
    const single = nestRes.headers.get('set-cookie');
    if (single) res.headers.append('Set-Cookie', rewriteCookieForAppHost(single));
  }

  return res;
}

/** Drop Domain= so the session sticks to app.cupkey.io, not timeblock-server. */
function rewriteCookieForAppHost(setCookie: string): string {
  return setCookie
    .split(';')
    .map((p) => p.trim())
    .filter((p) => !/^domain=/i.test(p))
    .join('; ');
}
