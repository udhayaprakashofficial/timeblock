'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type CSSProperties, type FormEvent } from 'react';
import type { AuthConfigDto, UserDto } from '@timeblock/shared-types';
import { api } from '../api';
import './auth.css'; // LAYOUT_FIX_V1

type AuthMode = 'signin' | 'signup';

function initialMode(): AuthMode {
  const path = window.location.pathname;
  if (path.includes('signup') || path.includes('sign-up')) return 'signup';
  const q = new URLSearchParams(window.location.search).get('mode');
  if (q === 'signup') return 'signup';
  return 'signin';
}

/** Safety net if external CSS fails to load (stale Vite / HMR). Must be above LoginScreen (TDZ). */
const AUTH_CRITICAL_CSS = `
.auth-screen{display:block!important;min-height:100vh!important;width:100%!important;padding:32px 16px!important;box-sizing:border-box!important;background:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(139,92,246,.22),transparent),linear-gradient(180deg,#0b0b0f,#121218 50%,#0e0e14)!important;color:#f5f5f7!important}
.auth-card{display:block!important;width:min(400px,100%)!important;max-width:400px!important;margin:0 auto!important;padding:36px 32px 28px!important;border-radius:14px!important;background:#1a1a1f!important;border:1px solid #2a2a32!important;text-align:center!important;box-sizing:border-box!important}
.auth-form{display:block!important;width:100%!important;text-align:left!important}
.auth-field{display:block!important;width:100%!important;margin:0 0 14px!important}
.auth-field>span{display:block!important;width:100%!important;margin:0 0 6px!important}
.auth-field input{display:block!important;width:100%!important;height:40px!important;padding:0 12px!important;border-radius:8px!important;border:1px solid #33333d!important;background:#121217!important;color:#f9fafb!important;box-sizing:border-box!important}
.auth-continue,.auth-social-btn{display:block!important;width:100%!important;box-sizing:border-box!important}
`;

const screenStyle: CSSProperties = {
  minHeight: '100vh',
  width: '100%',
  display: 'block',
  padding: '32px 16px',
  boxSizing: 'border-box',
  background:
    'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(139, 92, 246, 0.22), transparent), linear-gradient(180deg, #0b0b0f 0%, #121218 50%, #0e0e14 100%)',
  color: '#f5f5f7',
};

const cardStyle: CSSProperties = {
  display: 'block',
  width: 'min(400px, 100%)',
  maxWidth: 400,
  margin: '0 auto',
  padding: '36px 32px 28px',
  borderRadius: 14,
  background: '#1a1a1f',
  border: '1px solid #2a2a32',
  boxShadow: '0 24px 48px rgba(0, 0, 0, 0.45)',
  textAlign: 'center',
  boxSizing: 'border-box',
};

/**
 * Clerk-style auth card: Google (browser GIS) + email/password.
 * Browser GIS avoids server→Google token exchange (often blocked / fails with authError=google).
 */
export function LoginScreen({
  onSignedIn,
}: {
  onSignedIn: (user: UserDto) => void;
}) {
  const authConfig = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<AuthConfigDto>('/api/users/auth-config'),
  });

  const authError = new URLSearchParams(window.location.search).get('authError');
  const googleOAuth = Boolean(authConfig.data?.googleCalendarOAuth);
  const googleClientId = authConfig.data?.googleClientId ?? null;

  if (authConfig.isLoading) {
    return (
      <div className="auth-screen" style={screenStyle}>
        <style>{AUTH_CRITICAL_CSS}</style>
        <div className="auth-card" style={cardStyle}>
          <p className="auth-loading">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <AuthCard
      googleEnabled={googleOAuth}
      googleClientId={googleClientId}
      authError={authError}
      onSignedIn={onSignedIn}
    />
  );
}

const formStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  margin: 0,
  textAlign: 'left',
};

const fieldStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  margin: '0 0 14px',
  boxSizing: 'border-box',
};

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid #33333d',
  background: '#121217',
  color: '#f9fafb',
  outline: 'none',
  boxSizing: 'border-box',
};

const continueStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  height: 42,
  border: 'none',
  borderRadius: 8,
  background: '#8b5cf6',
  color: '#0b0b0f',
  fontWeight: 650,
  fontSize: '0.95rem',
  cursor: 'pointer',
  boxSizing: 'border-box',
};

const socialBtnStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 40,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid #33333d',
  background: '#212128',
  color: '#f3f4f6',
  fontSize: '0.9rem',
  fontWeight: 500,
  cursor: 'pointer',
  boxSizing: 'border-box',
};

function AuthCard({
  googleEnabled,
  googleClientId,
  authError,
  onSignedIn,
}: {
  googleEnabled: boolean;
  googleClientId: string | null;
  authError: string | null;
  onSignedIn: (user: UserDto) => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (authError === 'google' || authError === 'google_token') {
      return 'Google server sign-in failed. Click Continue with Google again (browser sign-in).';
    }
    if (authError === 'google_not_configured') {
      return 'Google OAuth is not configured on the server.';
    }
    if (authError === 'origin_mismatch' || authError === 'redirect_uri_mismatch') {
      return `Add this origin in Google Cloud → Credentials → Authorized JavaScript origins: ${window.location.origin}`;
    }
    if (authError === 'exchange') {
      return 'Google sign-in handoff failed. Try again.';
    }
    return authError;
  });

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    const url = new URL(window.location.href);
    if (next === 'signup') url.searchParams.set('mode', 'signup');
    else url.searchParams.delete('mode');
    window.history.replaceState({}, '', url.pathname + url.search);
  };

  const onGoogleClick = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!googleClientId) {
        throw new Error('Google Client ID is not configured');
      }
      await loadGoogleIdentityScript();
      const accessToken = await requestGoogleAccessToken(googleClientId);
      const profile = await fetchGoogleProfile(accessToken);
      const user = await api.post<UserDto>('/api/auth/google/browser', {
        accessToken,
        email: profile.email,
        name: profile.name,
        googleId: profile.id,
      });
      // Clear authError from URL
      window.history.replaceState({}, '', '/');
      onSignedIn(user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      if (/origin|idpiframe|popup_closed|access_denied/i.test(msg)) {
        setError(
          `Google blocked this origin. In Google Cloud Console → OAuth client → Authorized JavaScript origins, add: ${window.location.origin}`,
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const path = mode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const body =
        mode === 'signup'
          ? { email, password, name: name || undefined }
          : { email, password };
      const user = await api.post<UserDto>(path, body);
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'signin' ? 'Sign in to Timeblock' : 'Create your Timeblock account';
  const subtitle =
    mode === 'signin'
      ? 'Welcome back! Please sign in to continue'
      : 'Welcome! Please fill in the details to get started';

  return (
    <div className="auth-screen" style={screenStyle}>
      <style>{AUTH_CRITICAL_CSS}</style>
      <div className="auth-card" data-mode={mode} style={cardStyle}>
        <Link href="/" className="auth-brand" aria-label="Timeblock home">
          <span className="auth-brand-mark" aria-hidden />
          <span className="auth-brand-name">timeblock</span>
        </Link>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>

        {googleEnabled && (
          <>
            <div className="auth-social" style={{ width: '100%', marginBottom: 4 }}>
              <button
                type="button"
                className="auth-social-btn auth-social-btn-full"
                style={socialBtnStyle}
                disabled={busy}
                onClick={onGoogleClick}
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </div>
            <div className="auth-divider" role="separator">
              <span>or</span>
            </div>
          </>
        )}

        <form className="auth-form" style={formStyle} onSubmit={onSubmit}>
          {mode === 'signup' && (
            <label className="auth-field" style={fieldStyle}>
              <span>Full name</span>
              <input
                type="text"
                autoComplete="name"
                placeholder="Enter your name"
                style={inputStyle}
                value={name}
                onChange={(ev) => setName(ev.target.value)}
              />
            </label>
          )}
          <label className="auth-field" style={fieldStyle}>
            <span>Email address</span>
            <input
              type="email"
              autoComplete="email"
              required
              placeholder="Enter your email address"
              style={inputStyle}
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
            />
          </label>
          <label className="auth-field" style={fieldStyle}>
            <span>Password</span>
            <input
              type="password"
              autoComplete={
                mode === 'signup' ? 'new-password' : 'current-password'
              }
              required
              minLength={6}
              placeholder={
                mode === 'signup' ? 'Create a password' : 'Enter your password'
              }
              style={inputStyle}
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
            />
          </label>
          <button
            className="auth-continue"
            type="submit"
            disabled={busy}
            style={continueStyle}
          >
            {busy
              ? mode === 'signup'
                ? 'Creating account…'
                : 'Signing in…'
              : mode === 'signup'
                ? 'Sign up'
                : 'Continue'}
            <span className="auth-continue-arrow" aria-hidden>
              →
            </span>
          </button>
        </form>

        {error && <p className="auth-error">{error}</p>}

        <div className="auth-footer">
          {mode === 'signin' ? (
            <p>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="auth-link"
                onClick={() => switchMode('signup')}
              >
                Sign up
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <button
                type="button"
                className="auth-link"
                onClick={() => switchMode('signin')}
              >
                Sign in
              </button>
            </p>
          )}
        </div>
        <p className="auth-secured">Secured by Timeblock</p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="google-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

type GoogleTokenClient = {
  requestAccessToken: (override?: { prompt?: string }) => void;
};

type GoogleAccountsOauth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: { access_token?: string; error?: string }) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => GoogleTokenClient;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleAccountsOauth2 } };
  }
}

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-gis]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Failed to load Google Identity script')),
      );
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleGis = '1';
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Failed to load Google Identity script'));
    document.head.appendChild(script);
  });
}

function requestGoogleAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('Google Identity Services not available'));
      return;
    }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope:
        'email profile openid https://www.googleapis.com/auth/calendar.readonly',
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'No Google access token'));
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || 'Google popup failed'));
      },
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
}

async function fetchGoogleProfile(accessToken: string): Promise<{
  id: string;
  email: string;
  name: string;
}> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error('Failed to load Google profile');
  }
  const data = (await res.json()) as {
    sub?: string;
    email?: string;
    name?: string;
  };
  if (!data.sub || !data.email) {
    throw new Error('Google profile missing email');
  }
  return {
    id: data.sub,
    email: data.email,
    name: data.name || data.email,
  };
}
