'use client';

import { useEffect, useState } from 'react';
import { CupkeyLogo } from './CupkeyLogo';

const STAGES = [
  'Saving your hours…',
  'Building today’s plan…',
  'Placing your tasks…',
  'Finishing setup…',
  'Almost ready — stay on this page…',
];

type Props = {
  title?: string;
  /** Extra class for light onboarding vs dashboard theme */
  variant?: 'onboard' | 'dash';
};

/**
 * Full-screen boot loader with a progress bar + rotating status copy
 * so users stay put while setup finishes.
 */
export function BootProgressScreen({
  title = 'Building your day…',
  variant = 'onboard',
}: Props) {
  const [pct, setPct] = useState(6);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const progress = window.setInterval(() => {
      setPct((p) => {
        if (p >= 92) return p;
        const step = p < 40 ? 3.2 : p < 70 ? 2.1 : 0.9;
        return Math.min(92, p + step);
      });
    }, 280);

    const rot = window.setInterval(() => {
      setStage((s) => (s + 1) % STAGES.length);
    }, 2200);

    return () => {
      window.clearInterval(progress);
      window.clearInterval(rot);
    };
  }, []);

  const root =
    variant === 'dash' ? 'dash-boot-screen' : 'onboard-boot-screen';

  return (
    <div className={`${root} boot-progress`} role="status" aria-live="polite">
      <div className="boot-progress-mark" aria-hidden>
        <CupkeyLogo size={variant === 'dash' ? 40 : 44} title="Cupkey" />
      </div>
      <p className={variant === 'dash' ? 'dash-boot-label' : 'onboard-boot-label'}>
        {title}
      </p>
      <p className="boot-progress-stage">{STAGES[stage]}</p>
      <div
        className="boot-progress-track"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        role="progressbar"
        aria-label="Setup progress"
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="boot-progress-hint">Please keep this page open</p>
    </div>
  );
}
