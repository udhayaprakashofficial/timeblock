import type { UserDto } from '@timeblock/shared-types';
import { api } from '../api';

type GisTokenClient = {
  requestAccessToken: (override?: { prompt?: string }) => void;
};

type GisOauth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: {
      access_token?: string;
      error?: string;
      error_description?: string;
    }) => void;
    error_callback?: (err: unknown) => void;
  }) => GisTokenClient;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}

async function waitForGis(timeoutMs = 8000): Promise<GisOauth2> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const oauth2 = window.google?.accounts?.oauth2;
    if (oauth2?.initTokenClient) return oauth2;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Google sign-in is still loading. Try again.');
}

async function profileFromAccessToken(accessToken: string): Promise<{
  email: string;
  name: string;
  googleId: string;
}> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = (await res.json()) as {
    id?: string;
    email?: string;
    name?: string;
  };
  if (!res.ok || !profile.email || !profile.id) {
    throw new Error('Could not read your Google profile');
  }
  return {
    email: profile.email,
    name: profile.name || profile.email,
    googleId: profile.id,
  };
}

/**
 * Browser Google sign-in via GIS token client (no redirect_uri).
 * Avoids Error 400 redirect_uri_mismatch from the code redirect flow.
 */
export async function signInWithGoogleGis(input: {
  clientId: string;
  /** Include calendar.readonly when connecting Google Calendar from Settings. */
  calendar?: boolean;
}): Promise<UserDto> {
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error('Google sign-in is not configured');

  const oauth2 = await waitForGis();
  const scope = input.calendar
    ? 'email profile openid https://www.googleapis.com/auth/calendar.readonly'
    : 'email profile openid';

  const accessToken = await new Promise<string>((resolve, reject) => {
    try {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope,
        callback: (resp) => {
          if (resp.error || !resp.access_token) {
            reject(
              new Error(
                resp.error_description ||
                  resp.error ||
                  'Google sign-in was cancelled',
              ),
            );
            return;
          }
          resolve(resp.access_token);
        },
        error_callback: (err) => {
          reject(
            err instanceof Error
              ? err
              : new Error('Google sign-in failed'),
          );
        },
      });
      client.requestAccessToken({
        prompt: input.calendar ? 'consent' : '',
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Google sign-in failed'));
    }
  });

  const profile = await profileFromAccessToken(accessToken);
  return api.post<UserDto>('/api/auth/google/browser', {
    accessToken,
    email: profile.email,
    name: profile.name,
    googleId: profile.googleId,
  });
}
