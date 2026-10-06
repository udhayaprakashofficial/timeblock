'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'tb.pinTab.dismissed';
const SHOW_DELAY_MS = 1200;
const LEAVE_MS = 220;

function isDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* private mode */
  }
}

/**
 * One-time, non-blocking toast asking the user to pin the Cupkey tab.
 * Browsers cannot pin a tab for them — this is only a reminder.
 */
export function PinTabNudge() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isDismissed()) return;
    const t = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  const dismiss = () => {
    persistDismissed();
    setLeaving(true);
    window.setTimeout(() => setOpen(false), LEAVE_MS);
  };

  if (!mounted || !open) return null;

  return createPortal(
    <aside
      className={`pin-tab-toast${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Pin this tab for quick access"
    >
      <p className="pin-tab-toast-msg">📌 Pin this tab for quick access</p>
      <div className="pin-tab-toast-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm pin-tab-toast-gotit"
          onClick={dismiss}
        >
          Got it
        </button>
        <button
          type="button"
          className="pin-tab-toast-close"
          aria-label="Dismiss"
          onClick={dismiss}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
            <path
              d="M2 2l8 8M10 2L2 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </aside>,
    document.body,
  );
}
