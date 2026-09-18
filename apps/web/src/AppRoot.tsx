'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ThemePreference, UserDto } from '@timeblock/shared-types';
import { api, detectBrowserTimeZone } from './api';
import { ThemeProvider, useTheme } from './theme';
import { RightPanel } from './components/RightPanel';
import { LoginScreen } from './auth/SignInCard';
import { UserProvider } from './user-context';
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
}: {
  href: string;
  exact?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link href={href} className={active ? 'active' : undefined}>
      {children}
    </Link>
  );
}

function LogoutButton({ onLoggedOut }: { onLoggedOut: () => void }) {
  const qc = useQueryClient();
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

  if (clerkKey) {
    return (
      <Suspense fallback={null}>
        <ClerkLogoutLazy onLoggedOut={onLoggedOut} />
      </Suspense>
    );
  }

  return (
    <button
      className="btn btn-ghost"
      type="button"
      onClick={() => {
        void api.post('/api/auth/logout').finally(() => {
          qc.setQueryData(['me'], null);
          onLoggedOut();
        });
      }}
      style={{ justifyContent: 'flex-start', paddingLeft: 4 }}
    >
      ↩ Logout
    </button>
  );
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
  const qc = useQueryClient();
  const offline = typeof user.id === 'string' && user.id.startsWith('local_');

  useEffect(() => {
    if (user.theme === 'light' || user.theme === 'dark') {
      setTheme(user.theme);
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
    },
  });

  const onToggleTheme = useCallback(() => {
    const next: ThemePreference = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    persistTheme.mutate(next);
  }, [theme, setTheme, persistTheme]);

  return (
    <UserProvider user={user}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Timeblock.
        </div>

        <div className="profile-chip">
          <div className="avatar">{initials(user.name)}</div>
          <div>
            <div className="name">{user.name}</div>
            <div className="role">Personal planner</div>
          </div>
        </div>

        <nav className="nav">
          <NavItem href="/schedule" exact>
            <span className="nav-icon">▦</span> My Schedule
          </NavItem>
          <NavItem href="/today">
            <span className="nav-icon">▣</span> Today
          </NavItem>
          <NavItem href="/report">
            <span className="nav-icon">↗</span> Weekly report
          </NavItem>
          <NavItem href="/timesheet">
            <span className="nav-icon">☰</span> Timesheet
          </NavItem>
          <NavItem href="/badges">
            <span className="nav-icon">◈</span> Badges
          </NavItem>
          <NavItem href="/settings">
            <span className="nav-icon">⚙</span> Settings
          </NavItem>
        </nav>

        <div className="sidebar-footer">
          <LogoutButton onLoggedOut={onLoggedOut} />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="search-bar">
            <span aria-hidden>⌕</span>
            <input placeholder="Search tasks, events…" readOnly />
          </div>
          <button
            className="btn btn-outline btn-pill"
            type="button"
            onClick={onToggleTheme}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </header>
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
      <RightPanel user={user} />
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

  useEffect(() => {
    setSessionUser(readCachedUser());
    setExchanging(
      new URLSearchParams(window.location.search).has('loginCode'),
    );
    setHydrated(true);
  }, []);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const data = await api.get<UserDto | null>('/api/users/me');
        return data ?? null;
      } catch {
        return null;
      }
    },
    retry: 1,
    staleTime: 30_000,
    enabled: hydrated && !exchanging,
  });

  const user = sessionUser ?? me.data ?? null;

  const handleSignedIn = useCallback(
    (next: UserDto) => {
      const normalized = normalizeUser(next);
      writeCachedUser(normalized);
      setSessionUser(normalized);
      qc.setQueryData(['me'], normalized);
      router.replace('/schedule');
    },
    [qc, router],
  );

  const handleLoggedOut = useCallback(() => {
    writeCachedUser(null);
    setSessionUser(null);
    qc.setQueryData(['me'], null);
    router.replace('/');
  }, [qc, router]);

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
    if (!hydrated || me.isLoading || exchanging) return;
    if (me.data) {
      writeCachedUser(me.data);
      setSessionUser(me.data);
      return;
    }
    if (sessionUser && me.data === null) {
      writeCachedUser(null);
      setSessionUser(null);
    }
  }, [me.data, me.isLoading, exchanging, sessionUser, hydrated]);

  useEffect(() => {
    if (!hydrated || exchanging) return;
    if (user && isLanding) {
      router.replace('/schedule');
    }
  }, [hydrated, exchanging, user, isLanding, router]);

  useEffect(() => {
    if (!hydrated || exchanging || me.isLoading) return;
    if (!user && !isPublic) {
      router.replace('/login');
    }
  }, [hydrated, exchanging, me.isLoading, user, isPublic, router]);

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
    } else {
      body = (
        <div className="auth-screen">
          <div className="auth-card">
            <p className="auth-loading">Redirecting…</p>
          </div>
        </div>
      );
    }
  } else if (isLanding) {
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

  return <ThemeProvider forceLight={isPublic}>{body}</ThemeProvider>;
}

export type { UserDto };
