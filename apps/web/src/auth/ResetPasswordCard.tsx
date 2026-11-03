'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { CupkeyLogo } from '../components/CupkeyLogo';
import './auth.css';

export function ResetPasswordCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('This reset link is missing or incomplete.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post<{ ok: true }>('/api/auth/reset-password', {
        token,
        password,
      });
      setDone(true);
      window.setTimeout(() => router.replace('/login'), 1600);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not reset password',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-kit">
      <section className="auth-kit-left">
        <Link href="/" className="auth-kit-logo" aria-label="Cupkey home">
          <CupkeyLogo variant="wordmark" size={28} title="Cupkey" />
        </Link>
        <p className="auth-kit-kicker">Account</p>
        <h1>Choose a new password.</h1>
        <p className="auth-kit-lede">
          Pick something you have not used elsewhere. The link works once and
          expires in an hour.
        </p>

        {done ? (
          <p className="auth-kit-notice">
            Password updated. Taking you to sign in…
          </p>
        ) : !token ? (
          <p className="auth-kit-error">
            This reset link is missing or incomplete. Request a new one from
            sign in.
          </p>
        ) : (
          <form className="auth-kit-form" onSubmit={onSubmit}>
            <div className="auth-kit-email-row">
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="New password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                disabled={busy}
              />
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="Confirm password"
                value={confirm}
                onChange={(ev) => setConfirm(ev.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy}
              >
                {busy ? '…' : 'Update password'}
              </button>
            </div>
          </form>
        )}

        {error ? <p className="auth-kit-error">{error}</p> : null}

        <p className="auth-kit-switch">
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>
      <aside className="auth-kit-right" aria-hidden>
        <p className="auth-kit-right-kicker">Secure reset</p>
        <p className="auth-kit-right-copy">
          Links are signed, expire in one hour, and stop working after you set a
          new password.
        </p>
      </aside>
    </div>
  );
}
