'use client';

import { useEffect } from 'react';
import { useAppSelector } from '../store/hooks';
import { selectTasksPersistStatus } from '../store/tasksSlice';

/**
 * Always-visible persistence badge near search.
 * Redux stays the UI source of truth; this only reflects API flush state.
 */
export function TasksPersistStatus() {
  const status = useAppSelector(selectTasksPersistStatus);

  useEffect(() => {
    if (status !== 'saving') return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for Chrome / Safari to show the native leave warning.
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [status]);

  if (status === 'saving') {
    return (
      <span className="topbar-persist is-saving" role="status" aria-live="polite">
        Saving…
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="topbar-persist is-error" role="status" aria-live="polite">
        Save failed
      </span>
    );
  }

  return (
    <span className="topbar-persist is-saved" role="status" aria-live="polite">
      Saved
    </span>
  );
}
