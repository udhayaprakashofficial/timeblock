'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  dismissHint,
  hintForRoute,
  readDismissedHints,
  type HintCopy,
} from './hints';

/** First-visit strip with Cupkey route context — dismisses per tip id. */
export function ContextTipBanner() {
  const pathname = usePathname() || '/';
  const [tip, setTip] = useState<HintCopy | null>(null);

  useEffect(() => {
    const next = hintForRoute(pathname);
    if (!next) {
      setTip(null);
      return;
    }
    const dismissed = readDismissedHints();
    setTip(dismissed.has(next.id) ? null : next);
  }, [pathname]);

  if (!tip) return null;

  return (
    <aside className="context-tip" role="status">
      <div className="context-tip-copy">
        <span className="context-tip-kicker">Cupkey tip</span>
        <strong>{tip.title}</strong>
        <p>{tip.body}</p>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm context-tip-dismiss"
        aria-label="Dismiss tip"
        onClick={() => {
          dismissHint(tip.id);
          setTip(null);
        }}
      >
        Got it
      </button>
    </aside>
  );
}
