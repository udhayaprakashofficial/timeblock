'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties, type FormEvent } from 'react';
import type { AuthConfigDto, UserDto } from '@timeblock/shared-types';
import { api } from '../api';
import { CupkeyLogo } from '../components/CupkeyLogo';
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
.auth-screen{display:block!important;min-height:100vh!important;width:100%!important;padding:32px 16px!important;box-sizing:border-box!important;background:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(255,87,34,.22),transparent),linear-gradient(180deg,#0a0a0a,#121212 50%,#0e0e0e)!important;color:#f5f5f7!important}
.auth-card{display:block!important;width:min(400px,100%)!important;max-width:400px!important;margin:0 auto!important;padding:36px 32px 28px!important;border-radius:14px!important;background:#161616!important;border:1px solid #2a2a2a!important;text-align:center!important;box-sizing:border-box!important}
.auth-brand{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;margin:0 auto 20px!important;text-decoration:none!important;color:inherit!important}
.auth-form{display:block!important;width:100%!important;text-align:left!important}
.auth-field{display:block!important;width:100%!important;margin:0 0 14px!important}
.auth-field>span{display:block!important;width:100%!important;margin:0 0 6px!important}
.auth-field input{display:block!important;width:100%!important;height:40px!important;padding:0 12px!important;border-radius:8px!important;border:1px solid #333!important;background:#0f0f0f!important;color:#f9fafb!important;box-sizing:border-box!important}
.auth-continue,.auth-social-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;width:100%!important;min-height:44px!important;height:44px!important;padding:0 14px!important;box-sizing:border-box!important;line-height:1!important}
.auth-social-btn .google-icon{width:18px!important;height:18px!important;flex-shrink:0!important;display:block!important}
`;

const screenStyle: CSSProperties = {
  minHeight: '100vh',
  width: '100%',
  display: 'block',
  padding: '32px 16px',
  boxSizing: 'border-box',
  background:
    'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255, 87, 34, 0.22), transparent), linear-gradient(180deg, #0a0a0a 0%, #121212 50%, #0e0e0e 100%)',
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
 * Auth card: Google OAuth (when configured) + email/password.
 * Google uses /api/auth/google so JS origins are not required.
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
  const googleEnabled = Boolean(
    authConfig.data?.googleSignIn || authConfig.data?.googleCalendarOAuth,
  );

  if (authConfig.isLoading) {
    return (
      <div className="auth-kit">
        <style>{AUTH_CRITICAL_CSS}</style>
        <section className="auth-kit-left">
          <p className="auth-kit-lede">Loading…</p>
        </section>
      </div>
    );
  }

  return (
    <AuthCard
      googleEnabled={googleEnabled}
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
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
  marginTop: 4,
  minHeight: 44,
  height: 44,
  border: 'none',
  borderRadius: 8,
  background: 'linear-gradient(135deg, #ff8a50 0%, #ff5722 48%, #e64a19 100%)',
  color: '#fff',
  fontWeight: 650,
  fontSize: '0.95rem',
  cursor: 'pointer',
  boxSizing: 'border-box',
  lineHeight: 1,
};

const socialBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  minHeight: 44,
  height: 44,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid #33333d',
  background: '#212128',
  color: '#f3f4f6',
  fontSize: '0.9rem',
  fontWeight: 500,
  cursor: 'pointer',
  boxSizing: 'border-box',
  lineHeight: 1,
};

function AuthCard({
  googleEnabled,
  authError,
  onSignedIn,
}: {
  googleEnabled: boolean;
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
      return 'Google sign-in failed. Try again.';
    }
    if (authError === 'google_not_configured') {
      return 'Google OAuth is not configured on the server.';
    }
    if (authError === 'origin_mismatch' || authError === 'redirect_uri_mismatch') {
      return 'Google OAuth redirect URI mismatch. Check GOOGLE_CALLBACK_URL.';
    }
    if (authError === 'exchange') {
      return 'Google sign-in failed. Try again.';
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

  const onGoogleClick = () => {
    setError(null);
    setBusy(true);
    window.location.href = `/api/auth/google?returnTo=${encodeURIComponent('/')}`;
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
    mode === 'signin'
      ? 'Put your work where the time actually is.'
      : 'Build the day. Then stand in it.';
  const subtitle =
    mode === 'signin'
      ? 'Cupkey reads your calendars, packs your tasks into the gaps, and tells you at 6pm what really happened.'
      : 'Create an account, connect a calendar, and get a week you can hand to a lead.';

  return (
    <div className="auth-kit">
      <style>{AUTH_CRITICAL_CSS}</style>
      <section className="auth-kit-left">
        <Link href="/" className="auth-kit-logo" aria-label="Cupkey home">
          <CupkeyLogo variant="wordmark" size={28} title="Cupkey" />
        </Link>

        <p className="auth-kit-kicker">Plan the day in 4 minutes</p>
        <h1>{title}</h1>
        <p className="auth-kit-lede">{subtitle}</p>

        {googleEnabled ? (
          <>
            <div className="auth-kit-social">
              <button
                type="button"
                className="auth-kit-social-btn"
                disabled={busy}
                onClick={onGoogleClick}
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </div>
            <div className="auth-kit-or" role="separator">
              <span>or email</span>
            </div>
          </>
        ) : null}

        <form className="auth-kit-form" onSubmit={onSubmit}>
          {mode === 'signup' ? (
            <input
              type="text"
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
            />
          ) : null}
          <div className="auth-kit-email-row">
            <input
              type="email"
              autoComplete="email"
              required
              placeholder="you@work.com"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
            />
            <input
              type="password"
              autoComplete={
                mode === 'signup' ? 'new-password' : 'current-password'
              }
              required
              minLength={6}
              placeholder="Password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy
                ? '…'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Continue'}
            </button>
          </div>
        </form>

        {error ? <p className="auth-kit-error">{error}</p> : null}

        <p className="auth-kit-switch">
          {mode === 'signin' ? (
            <>
              New here?{' '}
              <button type="button" onClick={() => switchMode('signup')}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already in?{' '}
              <button type="button" onClick={() => switchMode('signin')}>
                Sign in
              </button>
            </>
          )}
        </p>

        <p className="auth-kit-footnote">
          No credit card. Your calendar stays read-only until you say otherwise.
        </p>
      </section>

      <aside className="auth-kit-right" aria-hidden>
        <p className="auth-kit-right-kicker">Friday, in review</p>
        <div className="auth-kit-stats">
          <div>
            <strong>6h 40m</strong>
            <span>Focused</span>
          </div>
          <div>
            <strong className="is-fire">9</strong>
            <span>Shipped</span>
          </div>
          <div>
            <strong>76%</strong>
            <span>Utilized</span>
          </div>
          <div>
            <strong>+12m</strong>
            <span>Est. drift</span>
          </div>
        </div>
        <div className="auth-kit-bars">
          <i style={{ width: '88%' }} />
          <i className="is-flare" style={{ width: '64%' }} />
          <i className="is-soft" style={{ width: '41%' }} />
          <i style={{ width: '77%' }} />
          <i className="is-soft" style={{ width: '22%' }} />
        </div>
        <p className="auth-kit-right-copy">
          Every week ends with a sheet you can hand to a lead — or post.
        </p>
      </aside>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg
      className="google-icon"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      aria-hidden
    >
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

