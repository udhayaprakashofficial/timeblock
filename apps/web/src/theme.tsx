'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThemePreference } from '@timeblock/shared-types';

type Theme = ThemePreference;

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
} | null>(null);

function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Theme is never stored in localStorage.
 * Logged-out: OS preference only.
 * Logged-in: parent passes DB value via `preference` and persists with `onPersist`.
 * Public marketing pages can force light so dark OS theme does not fight landing CSS.
 */
export function ThemeProvider({
  children,
  preference,
  onPersist,
  forceLight = false,
}: {
  children: ReactNode;
  preference?: Theme | null;
  onPersist?: (theme: Theme) => void;
  forceLight?: boolean;
}) {
  const [theme, setThemeState] = useState<Theme>(
    () => preference ?? systemTheme(),
  );

  useEffect(() => {
    if (preference === 'light' || preference === 'dark') {
      setThemeState(preference);
    }
  }, [preference]);

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      forceLight ? 'light' : theme,
    );
  }, [theme, forceLight]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      onPersist?.(next);
    },
    [onPersist],
  );

  const toggle = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [setTheme, theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Never crash the app on HMR / duplicate-module edge cases
    const theme = systemTheme();
    return {
      theme,
      setTheme: () => undefined,
      toggle: () => undefined,
    };
  }
  return ctx;
}
