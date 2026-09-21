'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ThemePreference, UserDto } from '@timeblock/shared-types';
import { api, detectBrowserTimeZone, AUTH_LOST_EVENT } from './api';
import { ThemeProvider, useTheme } from './theme';
import { RightPanel } from './components/RightPanel';
import { TopbarPulse } from './components/TopbarPulse';
import { TopbarSearch } from './components/TopbarSearch';
import { CupkeyLogo } from './components/CupkeyLogo';
import { LoginScreen } from './auth/SignInCard';
import { UserProvider } from './user-context';
import { DataBootstrap } from './store/DataBootstrap';
import './auth/auth.css';

/** Survives React StrictMode remounts — one exchange per loginCode. */
const loginCodeInflight = new Map<string, Promise<UserDto>>();

const AUTH_USER_KEY = 'timeblock.sessionUser';

const ClerkLogoutLazy = lazy(() =>
  import('./auth/ClerkLogout').then((m) => ({ default: m.ClerkLogout })),
);

function isValidUser(value: unknown): value is UserDto {
  if (!value || typeof value !== 'object') return false;
  const u = value as Partial<UserDto>;
  return (
    typeof u.id === 'string' &&
    typeof u.name === 'string' &&
    typeof u.email === 'string' &&
    Array.isArray(u.connectedProviders)
  );
}

function normalizeUser(user: UserDto): UserDto {
  return {
    ...user,
    theme: user.theme === 'dark' ? 'dark' : 'light',
    timezone: user.timezone || detectBrowserTimeZone(),
    defaultTaskMinutes:
      Number.isFinite(user.defaultTaskMinutes) && user.defaultTaskMinutes >= 5
        ? Math.round(user.defaultTaskMinutes)
        : 30,
  };
}

function readCachedUser(): UserDto | null {
  try {
    const raw = sessionStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidUser(parsed)) {
      sessionStorage.removeItem(AUTH_USER_KEY);
      return null;
    }
    return normalizeUser(parsed);
  } catch {
    return null;
  }
}

function writeCachedUser(user: UserDto | null) {
  try {
    if (!user) sessionStorage.removeItem(AUTH_USER_KEY);
    else sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(normalizeUser(user)));
  } catch {
    /* ignore quota */
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function NavItem({
  href,
  exact,
  children,
  title,
}: {
  href: string;
  exact?: boolean;
  children: ReactNode;
  title?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`nav-link${active ? ' active' : ''}`}
      data-tooltip={title}
      aria-label={title}
    >
      {children}
      {title ? <span className="nav-tooltip">{title}</span> : null}
    </Link>
  );
}

function LogoutButton({ onLoggedOut }: { onLoggedOut: () => void }) {
  const qc = useQueryClient();
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const [busy, setBusy] = useState(false);

  if (clerkKey) {
    return (
      <Suspense fallback={null}>
        <ClerkLogoutLazy onLoggedOut={onLoggedOut} />
      </Suspense>
    );
  }

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* still clear local session */
    } finally {
      qc.setQueryData(['me'], null);
      void qc.cancelQueries({ queryKey: ['me'] });
      onLoggedOut();
      setBusy(false);
    }
  };

  return (
    <button
      className="btn btn-ghost sidebar-logout"
      type="button"
      aria-label="Log out"
      title="Log out"
      disabled={busy}
      onClick={() => void logout()}
    >
      <span className="nav-icon" aria-hidden>
        ↩
      </span>
      <span className="nav-tooltip">Log out</span>
    </button>
  );
}

function greetingForHour(h: number) {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Shell({
  user,
  onLoggedOut,
  children,
}: {
  user: UserDto;
  onLoggedOut: () => void;
  children: ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const qc = useQueryClient();
  const offline = typeof user.id === 'string' && user.id.startsWith('local_');
  const firstName = user.name.split(/\s+/)[0] || user.name;
  const dateLine = useMemo(() => {
    const tz = user.timezone || detectBrowserTimeZone();
    try {
      const day = new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: tz,
      }).format(new Date());
      return `${day} · ${tz}`;
    } catch {
      return new Date().toLocaleDateString();
    }
  }, [user.timezone]);
  const greet = useMemo(() => {
    const tz = user.timezone || detectBrowserTimeZone();
    try {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(new Date()),
      );
      return greetingForHour(hour);
    } catch {
      return greetingForHour(new Date().getHours());
    }
  }, [user.timezone]);

  useEffect(() => {
    // Match product mock: dark orange dashboard by default
    if (user.theme === 'light' || user.theme === 'dark') {
      setTheme(user.theme);
    } else {
      setTheme('dark');
    }
  }, [user.theme, setTheme]);

  useEffect(() => {
    if (offline) return;
    const tz = detectBrowserTimeZone();
    if (!tz || user.timezone === tz) return;
    void api
      .patch<UserDto>('/api/users/me', { timezone: tz })
      .then((data) => {
        qc.setQueryData(['me'], data);
        writeCachedUser(data);
      })
      .catch(() => undefined);
  }, [user.id, user.timezone, qc, offline]);

  const providersKey = (user.connectedProviders ?? []).join(',');
  useEffect(() => {
    if (!providersKey || offline) return;
    void api
      .post<{ synced: string[] }>('/api/calendar/sync')
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['events'] });
        void qc.invalidateQueries({ queryKey: ['tasks'] });
        void qc.invalidateQueries({ queryKey: ['stats'] });
      })
      .catch(() => undefined);
  }, [user.id, providersKey, qc, offline]);

  const persistTheme = useMutation({
    mutationFn: (next: ThemePreference) =>
      api.patch<UserDto>('/api/users/me', { theme: next }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], data);
      writeCachedUser(data);
    },
  });

  const onToggleTheme = useCallback(() => {
    const next: ThemePreference = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    persistTheme.mutate(next);
  }, [theme, setTheme, persistTheme]);

  return (
    <UserProvider user={user}>
    <DataBootstrap userId={user.id} timeZone={user.timezone} />
    <div
      className={`app-shell${
        pathname.startsWith('/badges') || pathname.startsWith('/settings')
          ? ' is-wide'
          : ''
      }${pathname.startsWith('/badges') ? ' is-badges' : ''}${
        pathname.startsWith('/settings') ? ' is-settings' : ''
      }`}
    >
      <aside className="sidebar" aria-label="Primary">
        <Link href="/schedule" className="brand" aria-label="Cupkey home">
          <CupkeyLogo size={54} className="brand-logo" title="Cupkey" />
        </Link>

        <nav className="nav">
          <NavItem href="/schedule" exact title="Schedule">
            <span className="nav-icon" aria-hidden>
              ▦
            </span>
            <span className="nav-label">Schedule</span>
          </NavItem>
          <NavItem href="/today" title="Today">
            <span className="nav-icon" aria-hidden>
              ▣
            </span>
            <span className="nav-label">Today</span>
          </NavItem>
          <NavItem href="/report" title="Weekly report">
            <span className="nav-icon" aria-hidden>
              ↗
            </span>
            <span className="nav-label">Report</span>
          </NavItem>
          <NavItem href="/badges" title="Badges">
            <span className="nav-icon" aria-hidden>
              ◈
            </span>
            <span className="nav-label">Badges</span>
          </NavItem>
          <NavItem href="/timesheet" title="Timesheet">
            <span className="nav-icon" aria-hidden>
              ☰
            </span>
            <span className="nav-label">Timesheet</span>
          </NavItem>
          <NavItem href="/settings" title="Settings">
            <span className="nav-icon" aria-hidden>
              ⚙
            </span>
            <span className="nav-label">Settings</span>
          </NavItem>
        </nav>

        <div className="sidebar-footer">
          <div
            className="sidebar-rail-avatar"
            data-tooltip={user.name}
            aria-label={user.name}
          >
            {initials(user.name)}
            <span className="nav-tooltip">{user.name}</span>
          </div>
          <LogoutButton onLoggedOut={onLoggedOut} />
        </div>
      </aside>

      <header className="topbar">
        <div className="topbar-greeting">
          <span className="topbar-date">{dateLine}</span>
          <strong>
            {greet}, {firstName}
          </strong>
        </div>
        <TopbarSearch timeZone={user.timezone} />
        <div className="topbar-actions">
          <div className="view-toggle" aria-label="View">
            <Link
              href="/schedule"
              className={pathname.startsWith('/schedule') ? 'is-active' : undefined}
            >
              Day
            </Link>
            <Link
              href="/report"
              className={pathname.startsWith('/report') ? 'is-active' : undefined}
            >
              Week
            </Link>
            <Link
              href="/timesheet"
              className={pathname.startsWith('/timesheet') ? 'is-active' : undefined}
            >
              Sessions
            </Link>
          </div>
          <TopbarPulse timeZone={user.timezone} />
          <button
            className="btn btn-outline btn-pill topbar-theme"
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      <div className="main">
        <div className="content">
          {offline && (
            <div
              className="card"
              style={{
                padding: 12,
                marginBottom: 16,
                borderColor: 'var(--coral)',
              }}
            >
              <strong>Offline mode</strong> — Supabase is unreachable, so your
              login is stored on this machine only (not in the{' '}
              <code>User</code> table). Restart the API from your Mac Terminal
              with a working <code>DATABASE_URL</code>, then sign in again (or
              run <code>node scripts/push-local-to-supabase.js</code>).
            </div>
          )}
          {children}
        </div>
      </div>
      {!pathname.startsWith('/badges') &&
        !pathname.startsWith('/settings') && <RightPanel user={user} />}
    </div>
    </UserProvider>
  );
}

export function App({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const isLogin = pathname === '/login';
  const isPublic = isLanding || isLogin;
  const [sessionUser, setSessionUser] = useState<UserDto | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setSessionUser(readCachedUser());
    setExchanging(
      new URLSearchParams(window.location.search).has('loginCode'),
    );
    setHydrated(true);
  }, []);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<UserDto | null>('/api/users/me'),
    retry: 2,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    enabled: hydrated && !exchanging && !loggingOut,
  });

  // Never treat sessionStorage alone as auth — that caused "logged in UI" + 401 APIs.
  const user = loggingOut
    ? null
    : me.isSuccess
      ? me.data
      : me.isLoading || me.isFetching
        ? sessionUser
        : null;

  const handleSignedIn = useCallback(
    (next: UserDto) => {
      const normalized = normalizeUser(next);
      setLoggingOut(false);
      writeCachedUser(normalized);
      setSessionUser(normalized);
      qc.setQueryData(['me'], normalized);
      router.replace('/schedule');
    },
    [qc, router],
  );

  const handleLoggedOut = useCallback(() => {
    setLoggingOut(true);
    writeCachedUser(null);
    setSessionUser(null);
    qc.setQueryData(['me'], null);
    void qc.cancelQueries();
    qc.removeQueries({ queryKey: ['me'] });
    qc.clear();
    try {
      sessionStorage.removeItem('tb.coachMuteUntil');
    } catch {
      /* ignore */
    }
    router.replace('/login');
  }, [qc, router]);

  useEffect(() => {
    const onAuthLost = () => {
      if (loggingOut) return;
      handleLoggedOut();
    };
    window.addEventListener(AUTH_LOST_EVENT, onAuthLost);
    return () => window.removeEventListener(AUTH_LOST_EVENT, onAuthLost);
  }, [handleLoggedOut, loggingOut]);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const loginCode = params.get('loginCode');
    const authError = params.get('authError');

    if (authError) {
      setExchanging(false);
      return;
    }

    if (!loginCode) {
      setExchanging(false);
      return;
    }

    {
      const url = new URL(window.location.href);
      url.searchParams.delete('loginCode');
      url.searchParams.delete('auth');
      window.history.replaceState({}, '', url.pathname + url.search || '/');
    }

    setExchanging(true);

    let promise = loginCodeInflight.get(loginCode);
    if (!promise) {
      promise = api.post<UserDto>('/api/auth/exchange', { code: loginCode });
      loginCodeInflight.set(loginCode, promise);
    }

    let alive = true;
    void promise
      .then((next) => {
        handleSignedIn(next);
        loginCodeInflight.delete(loginCode);
      })
      .catch((e) => {
        console.error('[auth] login exchange failed', e);
        loginCodeInflight.delete(loginCode);
        if (!alive) return;
        const url = new URL(window.location.href);
        url.searchParams.set('authError', 'exchange');
        window.history.replaceState({}, '', url.pathname + url.search);
      })
      .finally(() => {
        if (alive) setExchanging(false);
      });

    return () => {
      alive = false;
    };
  }, [handleSignedIn, hydrated]);

  useEffect(() => {
    if (!hydrated || exchanging || loggingOut || !me.isSuccess) return;
    if (me.data) {
      writeCachedUser(me.data);
      setSessionUser(me.data);
      return;
    }
    // Only clear cached session when the server explicitly says "no user"
    if (sessionUser && me.data === null) {
      writeCachedUser(null);
      setSessionUser(null);
    }
  }, [me.data, me.isSuccess, exchanging, sessionUser, hydrated, loggingOut]);

  useEffect(() => {
    if (!hydrated || exchanging || loggingOut) return;
    // Authed users should never sit on marketing/login chrome
    if (user && (isLanding || isLogin)) {
      router.replace('/schedule');
    }
  }, [hydrated, exchanging, loggingOut, user, isLanding, isLogin, router]);

  useEffect(() => {
    if (!hydrated || exchanging || loggingOut || me.isLoading || me.isFetching)
      return;
    // Don't bounce to login on transient /me failures (common under rapid nav)
    if (!user && !isPublic && me.isSuccess && me.data === null) {
      router.replace('/login');
    }
  }, [
    hydrated,
    exchanging,
    loggingOut,
    me.isLoading,
    me.isFetching,
    me.isSuccess,
    me.data,
    user,
    isPublic,
    router,
  ]);

  let body: ReactNode;
  if (exchanging || (!hydrated && !isLanding)) {
    body = (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-loading">Signing you in…</p>
        </div>
      </div>
    );
  } else if (!user) {
    if (isLanding) {
      body = children;
    } else if (isLogin) {
      body = <LoginScreen onSignedIn={handleSignedIn} />;
    } else if (me.isError) {
      body = (
        <div className="auth-screen">
          <div className="auth-card">
            <p className="auth-loading">Connection hiccup — retrying session…</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => void me.refetch()}
            >
              Retry
            </button>
          </div>
        </div>
      );
    } else {
      body = (
        <div className="auth-screen">
          <div className="auth-card">
            <p className="auth-loading">
              {me.isLoading || me.isFetching ? 'Checking session…' : 'Redirecting…'}
            </p>
          </div>
        </div>
      );
    }
  } else if (isLanding || isLogin) {
    // Still on a public URL while session is warm — wait for replace('/schedule')
    body = (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-loading">Opening your schedule…</p>
        </div>
      </div>
    );
  } else {
    body = (
      <Shell user={user} onLoggedOut={handleLoggedOut}>
        {children}
      </Shell>
    );
  }

  return <ThemeProvider forceLight={isPublic && !user}>{body}</ThemeProvider>;
}

export type { UserDto };
