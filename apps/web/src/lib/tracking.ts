import type { UserDto } from '@timeblock/shared-types';

/** Thin, safe wrappers around window.ck* from public/ck-tracking.js. All no-ops on the server or if the script hasn't loaded. */
type CkWindow = Window & {
  ckTrack?: (name: string, params?: Record<string, unknown>) => void;
  ckIdentify?: (id: string) => void;
  ckPageView?: () => void;
  ckOpenConsent?: () => void;
};

function w(): CkWindow | null {
  return typeof window === 'undefined' ? null : (window as CkWindow);
}

/** ck-tracking.js loads afterInteractive; retry briefly so early calls aren't lost. */
function whenReady(fn: (win: CkWindow) => void, tries = 20) {
  const win = w();
  if (!win) return;
  if (win.ckTrack) {
    fn(win);
    return;
  }
  if (tries > 0) setTimeout(() => whenReady(fn, tries - 1), 250);
}

export function trackPageView() {
  w()?.ckPageView?.();
}

export function identifyUser(user: UserDto | null | undefined) {
  if (!user?.id) return;
  whenReady((win) => win.ckIdentify?.(user.id));
}

export function openCookieSettings() {
  w()?.ckOpenConsent?.();
}

const SIGNUP_SENT_KEY = 'ck_signup_sent';

/**
 * Fires sign_up once per user per browser. A user is treated as new when they
 * land without finished onboarding (the server sets onboardingCompleted=false on account creation).
 */
export function trackSignupIfNew(user: UserDto, opts: { isNew: boolean }) {
  if (!opts.isNew || !user?.id) return;
  const key = `${SIGNUP_SENT_KEY}:${user.id}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* storage blocked: still fire once for this page load */
  }
  const method = (user.connectedProviders ?? []).includes('google')
    ? 'google'
    : 'email';
  whenReady((win) => {
    win.ckIdentify?.(user.id);
    win.ckTrack?.('sign_up', { method });
  });
}
