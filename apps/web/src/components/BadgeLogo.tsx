'use client';

import type { EffortBadgeId, EffortBadgeTone } from '@timeblock/shared-types';

const TONE_FILL: Record<EffortBadgeTone, string> = {
  blue: 'var(--accent)',
  teal: 'var(--teal)',
  coral: 'var(--coral)',
  gold: 'var(--gold)',
};

/** Distinct badge logos (SVG) for earned / locked status chips. */
export function BadgeLogo({
  id,
  tone,
  earned,
  size = 36,
  title,
}: {
  id: EffortBadgeId;
  tone: EffortBadgeTone;
  earned?: boolean;
  size?: number;
  title?: string;
}) {
  const fill = earned
    ? TONE_FILL[tone]
    : 'color-mix(in srgb, var(--text-muted) 45%, var(--bg-elevated))';
  const stroke = earned
    ? 'color-mix(in srgb, #fff 88%, transparent)'
    : 'color-mix(in srgb, var(--text-muted) 70%, transparent)';

  return (
    <span
      className={`badge-logo${earned ? ' is-earned' : ' is-locked'}`}
      style={{ width: size, height: size, ['--badge-fill' as string]: fill }}
      title={title}
      aria-label={title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <circle cx="20" cy="20" r="18" fill="var(--badge-fill)" />
        <g
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {iconPaths(id)}
        </g>
      </svg>
    </span>
  );
}

function iconPaths(id: EffortBadgeId) {
  switch (id) {
    case 'planner':
      return (
        <>
          <rect x="12" y="11" width="16" height="18" rx="2" fill="none" />
          <path d="M16 9v4M24 9v4M12 17h16" />
        </>
      );
    case 'on_track':
      return <path d="M12 20l5 5 11-12" />;
    case 'day_closer':
      return (
        <>
          <circle cx="20" cy="20" r="8" fill="none" />
          <path d="M20 16v5l3 2" />
        </>
      );
    case 'daily_learner':
      return (
        <>
          <path d="M12 28V14l8-3 8 3v14" fill="none" />
          <path d="M20 11v17" />
          <path d="M14 18h4M22 18h4" />
        </>
      );
    case 'focus_zone':
      return (
        <>
          <circle cx="20" cy="20" r="9" fill="none" />
          <circle cx="20" cy="20" r="4.5" fill="none" />
          <circle cx="20" cy="20" r="1.5" fill="none" />
        </>
      );
    case 'week_warrior':
      return (
        <path d="M20 10l2.4 7.2H30l-6 4.4 2.3 7.2L20 24.6l-6.3 4.2 2.3-7.2-6-4.4h7.6z" />
      );
    case 'steady_streak':
      return (
        <>
          <path d="M14 26c0-6 4-8 4-12 4 2 8 6 8 12 0 3-2 5-6 5s-6-2-6-5z" />
          <path d="M18 18c1 2 2 3 2 5" />
        </>
      );
    case 'consistency':
      return (
        <>
          <path d="M12 22h4l2-8 3 12 2-6h5" fill="none" />
        </>
      );
    case 'timekeeper':
      return (
        <>
          <circle cx="20" cy="20" r="9" fill="none" />
          <path d="M20 14v7l4 2" />
        </>
      );
    case 'record_keeper':
      return (
        <>
          <path d="M13 12h14v16H13z" fill="none" />
          <path d="M16 17h8M16 21h8M16 25h5" />
        </>
      );
    case 'ai_spark':
      return (
        <>
          <path d="M20 10v4M20 26v4M10 20h4M26 20h4" />
          <path d="M14.5 14.5l2.5 2.5M23 23l2.5 2.5M25.5 14.5 23 17M17 23l-2.5 2.5" />
          <circle cx="20" cy="20" r="3.5" fill="none" />
        </>
      );
    default:
      return null;
  }
}
