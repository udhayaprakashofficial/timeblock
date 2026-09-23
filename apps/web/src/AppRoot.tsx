'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ThemePreference, UserDto } from '@timeblock/shared-types';
import { api, detectBrowserTimeZone, AUTH_LOST_EVENT, todayISO } from './api';
import { ThemeForceLight, ThemeSeed, useTheme } from './theme';
import { RightPanel } from './components/RightPanel';
import { TopbarPulse } from './components/TopbarPulse';
import { TopbarSearch } from './components/TopbarSearch';
import { CupkeyLogo } from './components/CupkeyLogo';
import { BootProgressScreen } from './components/BootProgressScreen';
import { HINTS } from './components/ui-hints/hints';
import { UiTooltip } from './components/ui-hints/UiTooltip';
import { onAvatarChange, readAvatar } from './components/user-avatar';
import { LoginScreen } from './auth/SignInCard';
import { UserProvider } from './user-context';
import { DataBootstrap } from './store/DataBootstrap';
import { useAppSelector } from './store/hooks';
import { OnboardingFlow } from './views/OnboardingFlow';
import './auth/auth.css';

/** Survives React StrictMode remounts — one exchange per loginCode. */
const loginCodeInflight = new Map<string, Promise<UserDto>>();

const AUTH_USER_KEY = 'timeblock.sessionUser';
const ONBOARD_DONE_PREFIX = 'tb.onboardingDone.';

function onboardDoneKey(userId: string) {
  return ONBOARD_DONE_PREFIX + userId;
}

function markOnboardingDone(userId: string) {
  try {
    localStorage.setItem(onboardDoneKey(userId), '1');
    sessionStorage.setItem(onboardDoneKey(userId), '1');
  } catch {
    /* ignore */
  }
}

function readOnboardingDone(userId: string): boolean {
  try {
    return (
      localStorage.getItem(onboardDoneKey(userId)) === '1' ||
      sessionStorage.getItem(onboardDoneKey(userId)) === '1'
    );
  } catch {
    return false;
  }
}

function clearOnboardingDone(userId: string) {
  try {
    localStorage.removeItem(onboardDoneKey(userId));
    sessionStorage.removeItem(onboardDoneKey(userId));
  } catch {
    /* ignore */
  }
}

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
  const stickyDone = readOnboardingDone(user.id);
  const completed = user.onboardingCompleted === true || stickyDone;
  if (completed) markOnboardingDone(user.id);
  return {
    ...user,
    theme: user.theme === 'dark' ? 'dark' : 'light',
    timezone: user.timezone || detectBrowserTimeZone(),
    defaultTaskMinutes:
      Number.isFinite(user.defaultTaskMinutes) && user.defaultTaskMinutes >= 5
        ? Math.round(user.defaultTaskMinutes)
        : 30,
    onboardingCompleted: completed,
    plan: user.plan === 'pro' ? 'pro' : 'free',
    planStatus: user.planStatus ?? null,
    planUpdatedAt: user.planUpdatedAt ?? null,
    proPaidAt: user.proPaidAt ?? null,
    proActivatedAt: user.proActivatedAt ?? null,
    dodoPaymentId: user.dodoPaymentId ?? null,
  };
}

function needsOnboarding(user: UserDto | null | undefined): boolean {
  return Boolean(user && user.onboardingCompleted !== true);
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

const FEEDBACK_URL = 'https://cupkey.featurebase.app/';

function NavItem({
  href,
  exact,
  children,
  title,
  tip,
}: {
  href: string;
  exact?: boolean;
  children: ReactNode;
  title?: string;
  tip?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  const link = (
    <Link
      href={href}
      className={`nav-link${active ? ' active' : ''}`}
      aria-label={title}
    >
      {children}
    </Link>
  );
  if (!title) return link;
  return (
    <UiTooltip label={title} body={tip} placement="right" className="nav-tip-wrap">
      {link}
    </UiTooltip>
  );
}

function RailAvatar({ name, userId }: { name: string; userId: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    setPhoto(readAvatar(userId));
    return onAvatarChange(() => setPhoto(readAvatar(userId)));
  }, [userId]);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      top: r.top + r.height / 2,
      left: r.right + 12,
    });
  }, []);

  const openMenu = useCallback(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    place();
    setOpen(true);
  }, [place]);

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      closeTimer.current = null;
    }, 120);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const items = [
    { href: '/settings', label: 'Profile', external: false },
    { href: '/settings?panel=account', label: 'Account', external: false },
    { href: '/pricing', label: 'Subscription', external: false },
    { href: '/settings?panel=help', label: 'Help', external: false },
    { href: FEEDBACK_URL, label: 'Feedback', external: true },
  ] as const;

  return (
    <div
      ref={wrapRef}
      className="rail-avatar-menu"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="sidebar-rail-avatar"
        aria-label={`${name} — account menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        onFocus={openMenu}
        onClick={openMenu}
      >
        <span className="sidebar-rail-avatar-face">
          {photo ? <img src={photo} alt="" /> : initials(name)}
        </span>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            className="rail-avatar-flyout"
            role="menu"
            aria-label="Account"
            style={{
              top: coords.top,
              left: coords.left,
            }}
            onMouseEnter={openMenu}
            onMouseLeave={scheduleClose}
          >
            {items.map((item) =>
              item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className="rail-avatar-flyout-item"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className="rail-avatar-flyout-item"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
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
    <UiTooltip label="Log out" placement="right" className="nav-tip-wrap">
      <button
        className="btn btn-ghost sidebar-logout"
        type="button"
        aria-label="Log out"
        disabled={busy}
        onClick={() => void logout()}
      >
        <span className="nav-icon" aria-hidden>
          ↩
        </span>
      </button>
    </UiTooltip>
  );
}

function greetingForHour(h: number) {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Full-screen gate until today’s tasks/stats bootstrap finishes. */
function DashboardReadyGate({
  userId,
  timeZone,
  onReady,
  children,
}: {
  userId: string;
  timeZone?: string | null;
  onReady?: () => void;
  children: ReactNode;
}) {
  const bootstrappedFor = useAppSelector((s) => s.stats.bootstrappedFor);
  const date = todayISO(timeZone);
  const key = `${userId}:${date}`;
  const ready = bootstrappedFor === key;
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => setTimedOut(true), 8_000);
    return () => window.clearTimeout(t);
  }, [ready]);

  const show = ready || timedOut;

  useEffect(() => {
    if (show) onReady?.();
  }, [show, onReady]);

  return (
    <>
      {!show && <BootProgressScreen variant="dash" />}
      <div
        className={
          show ? 'dash-boot-frame' : 'dash-boot-frame dash-boot-hidden'
        }
        aria-hidden={!show}
      >
        {children}
      </div>
    </>
  );
}

function Shell({
  user,
  onLoggedOut,
  onDashboardReady,
  children,
}: {
  user: UserDto;
  onLoggedOut: () => void;
  onDashboardReady?: () => void;
  children: ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const qc = useQueryClient();
  const offline = typeof user.id === 'string' && user.id.startsWith('local_');
  const firstName = user.name.split(/\s+/)[0] || user.name;
  const browserTz = useMemo(() => detectBrowserTimeZone(), []);
  const displayUser = useMemo(
    () => ({
      ...user,
      timezone: browserTz || user.timezone || 'UTC',
    }),
    [user, browserTz],
  );
  const dateLine = useMemo(() => {
    const tz = displayUser.timezone || detectBrowserTimeZone();
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
  }, [displayUser.timezone]);
  const greet = useMemo(() => {
    const tz = displayUser.timezone || detectBrowserTimeZone();
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
  }, [displayUser.timezone]);

  // Theme comes from ThemeProvider preference + optimistic toggle.
  // Do NOT sync user.theme → setTheme here — that snaps the UI back when
  // /me refetch or timezone patch returns before the theme PATCH lands.

  useEffect(() => {
    const tz = detectBrowserTimeZone();
    if (!tz || user.timezone === tz) return;
    void api
      .patch<UserDto>('/api/users/me', { timezone: tz })
      .then((data) => {
        // Preserve any theme the user just toggled (don't let tz PATCH clobber it)
        const current = qc.getQueryData<UserDto | null>(['me']);
        const merged = normalizeUser({
          ...data,
          theme:
            current?.theme === 'light' || current?.theme === 'dark'
              ? current.theme
              : data.theme,
        });
        qc.setQueryData(['me'], merged);
        writeCachedUser(merged);
        void qc.invalidateQueries({ queryKey: ['tasks'] });
        void qc.invalidateQueries({ queryKey: ['events'] });
        void qc.invalidateQueries({ queryKey: ['stats'] });
      })
      .catch(() => undefined);
  }, [user.id, user.timezone, qc]);

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
    onSuccess: (data, next) => {
      const merged = normalizeUser({ ...data, theme: next });
      qc.setQueryData(['me'], merged);
      writeCachedUser(merged);
    },
    onError: () => {
      // Keep local theme — server sync is best-effort
    },
  });

  const onToggleTheme = useCallback(() => {
    const next: ThemePreference = theme === 'light' ? 'dark' : 'light';
    // Apply immediately (localStorage + DOM) — do not wait on /me
    setTheme(next);
    const optimistic = normalizeUser({ ...user, theme: next });
    qc.setQueryData(['me'], optimistic);
    writeCachedUser(optimistic);
    persistTheme.mutate(next);
  }, [theme, setTheme, persistTheme, user, qc]);

  return (
    <UserProvider user={displayUser}>
    <DataBootstrap userId={displayUser.id} timeZone={displayUser.timezone} />
    <DashboardReadyGate
      userId={displayUser.id}
      timeZone={displayUser.timezone}
      onReady={onDashboardReady}
    >
    <div
      className={`app-shell${
        pathname.startsWith('/badges') ||
        pathname.startsWith('/settings') ||
        pathname.startsWith('/pricing') ||
        pathname.startsWith('/admin')
          ? ' is-wide'
          : ''
      }${pathname.startsWith('/badges') ? ' is-badges' : ''}${
        pathname.startsWith('/settings') ? ' is-settings' : ''
      }${pathname.startsWith('/pricing') ? ' is-pricing' : ''}${
        pathname.startsWith('/admin') ? ' is-admin' : ''
      }`}
    >
      <aside className="sidebar" aria-label="Primary">
        <Link href="/schedule" className="brand" aria-label="Cupkey home">
          <CupkeyLogo size={54} className="brand-logo" title="Cupkey" />
        </Link>

        <nav className="nav">
          <NavItem
            href="/schedule"
            exact
            title={HINTS['nav.schedule'].title}
            tip={HINTS['nav.schedule'].body}
          >
            <span className="nav-icon" aria-hidden>
              ▦
            </span>
            <span className="nav-label">Schedule</span>
          </NavItem>
          <NavItem
            href="/today"
            title={HINTS['nav.today'].title}
            tip={HINTS['nav.today'].body}
          >
            <span className="nav-icon" aria-hidden>
              ▣
            </span>
            <span className="nav-label">Today</span>
          </NavItem>
          <NavItem
            href="/report"
            title={HINTS['nav.report'].title}
            tip={HINTS['nav.report'].body}
          >
            <span className="nav-icon" aria-hidden>
              ↗
            </span>
            <span className="nav-label">Report</span>
          </NavItem>
          <NavItem
            href="/timesheet"
            title={HINTS['nav.timesheet'].title}
            tip={HINTS['nav.timesheet'].body}
          >
            <span className="nav-icon" aria-hidden>
              ☰
            </span>
            <span className="nav-label">Timesheet</span>
          </NavItem>
          <NavItem
            href="/badges"
            title={HINTS['nav.badges'].title}
            tip={HINTS['nav.badges'].body}
          >
            <span className="nav-icon" aria-hidden>
              ◈
            </span>
            <span className="nav-label">Badges</span>
          </NavItem>
          <NavItem
            href="/pricing"
            title={HINTS['nav.subscription'].title}
            tip={HINTS['nav.subscription'].body}
          >
            <span className="nav-icon" aria-hidden>
              ◆
            </span>
            <span className="nav-label">Subscription</span>
          </NavItem>
          <NavItem
            href="/settings"
            title={HINTS['nav.settings'].title}
            tip={HINTS['nav.settings'].body}
          >
            <span className="nav-icon" aria-hidden>
              ⚙
            </span>
            <span className="nav-label">Settings</span>
          </NavItem>
          {user.email.trim().toLowerCase() ===
          'udhayaprakashmohan@gmail.com' ? (
            <NavItem href="/admin" title="Admin" tip="Pro payers and activation">
              <span className="nav-icon" aria-hidden>
                ✦
              </span>
              <span className="nav-label">Admin</span>
            </NavItem>
          ) : null}
        </nav>

        <div className="sidebar-footer">
          <RailAvatar name={user.name} userId={user.id} />
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
        <TopbarSearch timeZone={displayUser.timezone} />
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
          <TopbarPulse timeZone={displayUser.timezone} />
          <button
            className="btn btn-outline btn-pill topbar-theme"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleTheme();
            }}
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
        !pathname.startsWith('/settings') &&
        !pathname.startsWith('/pricing') &&
        !pathname.startsWith('/admin') && (
          <RightPanel user={displayUser} />
        )}
    </div>
    </DashboardReadyGate>
    </UserProvider>
  );
}

export function App({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const isLogin = pathname === '/login';
  const isOnboarding = pathname.startsWith('/onboarding');
  const isSharedTimesheet = pathname.startsWith('/share/');
  const isPricing = pathname.startsWith('/pricing');
  const isPublic =
    isLanding || isLogin || isSharedTimesheet || isPricing;
  const [sessionUser, setSessionUser] = useState<UserDto | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [enteringDashboard, setEnteringDashboard] = useState(false);

  const clearEnteringDashboard = useCallback(() => {
    setEnteringDashboard(false);
  }, []);

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
      const u = await api.get<UserDto | null>('/api/users/me');
      return u ? normalizeUser(u) : null;
    },
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

      const returnTo = new URLSearchParams(window.location.search).get(
        'returnTo',
      );
      const safeReturn =
        returnTo &&
        returnTo.startsWith('/') &&
        !returnTo.startsWith('//')
          ? returnTo
          : null;

      if (safeReturn) {
        setEnteringDashboard(false);
        router.replace(safeReturn);
        return;
      }

      if (!needsOnboarding(normalized)) {
        setEnteringDashboard(true);
        router.replace('/schedule');
      } else {
        setEnteringDashboard(false);
        router.replace('/onboarding');
      }
    },
    [qc, router],
  );

  const handleLoggedOut = useCallback(() => {
    setLoggingOut(true);
    const priorId = sessionUser?.id;
    if (priorId) clearOnboardingDone(priorId);
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
  }, [qc, router, sessionUser?.id]);

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
    if (!user) return;

    // First-time users: Signup/Login → Onboarding → Dashboard
    if (needsOnboarding(user) && !isOnboarding && !isSharedTimesheet && !isPricing) {
      router.replace('/onboarding');
      return;
    }
    // Finished users: leave landing/login. Never auto-leave /onboarding —
    // only Build day / Skip navigates via onFinished → handleSignedIn.
    // Pricing stays reachable while signed in (Subscription sidebar).
    if (!needsOnboarding(user) && (isLanding || isLogin)) {
      router.replace('/schedule');
    }
  }, [
    hydrated,
    exchanging,
    loggingOut,
    user,
    isLanding,
    isLogin,
    isOnboarding,
    isSharedTimesheet,
    isPricing,
    router,
  ]);

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
  if (exchanging || (!hydrated && !isLanding && !isSharedTimesheet && !isPricing)) {
    body = (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-loading">Signing you in…</p>
        </div>
      </div>
    );
  } else if (!user) {
    if (isLanding || isSharedTimesheet || isPricing) {
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
  } else if (isSharedTimesheet) {
    // View-only share links — no dashboard chrome
    body = children;
  } else if (needsOnboarding(user)) {
    // Show setup immediately even if URL is still /login or / — don't wait
    // on router.replace('/onboarding') or a dead web process, which left users
    // stuck on "Opening setup…".
    body = <OnboardingFlow user={user} onFinished={handleSignedIn} />;
  } else if (isLanding || isLogin) {
    // Session ready, still on a public URL — brief handoff to /schedule
    body = (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-loading">Opening your schedule…</p>
        </div>
      </div>
    );
  } else if (isOnboarding) {
    body = <OnboardingFlow user={user} onFinished={handleSignedIn} />;
  } else {
    body = (
      <Shell
        user={user}
        onLoggedOut={handleLoggedOut}
        onDashboardReady={clearEnteringDashboard}
      >
        {children}
      </Shell>
    );
  }

  return (
    <>
      <ThemeForceLight
        active={
          (isPublic && !user) ||
          isOnboarding ||
          needsOnboarding(user)
        }
      />
      {user ? <ThemeSeed preference={user.theme} /> : null}
      {body}
    </>
  );
}

export type { UserDto };
