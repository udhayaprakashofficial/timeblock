'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ThemePreference } from '@timeblock/shared-types';

type Theme = ThemePreference;

const STORAGE_KEY = 'tb.theme';

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  setForceLight: (force: boolean) => void;
} | null>(null);

function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function readStored(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function writeStored(theme: Theme) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
}

function applyDomTheme(theme: Theme, forceLight: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(
    'data-theme',
    forceLight ? 'light' : theme,
  );
}

/**
 * Theme is local state + localStorage. Server preference only seeds when unset.
 * Toggles apply instantly and are never overwritten by /me refetches.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => readStored() ?? systemTheme(),
  );
  const [forceLight, setForceLightState] = useState(false);
  const forceLightRef = useRef(false);
  forceLightRef.current = forceLight;

  useEffect(() => {
    applyDomTheme(theme, forceLight);
  }, [theme, forceLight]);

  const setForceLight = useCallback((force: boolean) => {
    setForceLightState(force);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    writeStored(next);
    setThemeState(next);
    applyDomTheme(next, forceLightRef.current);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [setTheme, theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggle, setForceLight }),
    [theme, setTheme, toggle, setForceLight],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Marketing/onboarding can force light without remounting the provider. */
export function ThemeForceLight({ active }: { active: boolean }) {
  const { setForceLight } = useTheme();
  useEffect(() => {
    setForceLight(active);
    return () => setForceLight(false);
  }, [active, setForceLight]);
  return null;
}

/** Seed from /me once when the user has no local theme choice yet. */
export function ThemeSeed({ preference }: { preference?: Theme | null }) {
  const { setTheme } = useTheme();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    if (readStored()) {
      done.current = true;
      return;
    }
    if (preference === 'light' || preference === 'dark') {
      done.current = true;
      setTheme(preference);
    }
  }, [preference, setTheme]);
  return null;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    const theme = readStored() ?? systemTheme();
    return {
      theme,
      setTheme: (next: Theme) => {
        writeStored(next);
        applyDomTheme(next, false);
      },
      toggle: () => {
        const next: Theme = theme === 'light' ? 'dark' : 'light';
        writeStored(next);
        applyDomTheme(next, false);
      },
      setForceLight: (_force: boolean) => undefined,
    };
  }
  return ctx;
}
