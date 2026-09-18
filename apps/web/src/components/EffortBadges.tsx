'use client';

import { useMemo, useState } from 'react';
import type {
  EffortBadgeCategory,
  EffortBadgeDto,
  EffortSummaryDto,
} from '@timeblock/shared-types';
import { BadgeLogo } from './BadgeLogo';

const CATEGORY_LABEL: Record<EffortBadgeCategory, string> = {
  daily: 'Daily',
  consistency: 'Consistency',
  focus: 'Focus',
  insight: 'Insight',
};

const FILTERS: Array<{ id: 'all' | EffortBadgeCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'daily', label: 'Daily' },
  { id: 'consistency', label: 'Consistency' },
  { id: 'focus', label: 'Focus' },
  { id: 'insight', label: 'Insight' },
];

export function EffortBadges({
  effort,
}: {
  effort?: EffortSummaryDto | null;
}) {
  const [filter, setFilter] = useState<'all' | EffortBadgeCategory>('all');

  const badges = useMemo(() => {
    if (!effort) return [];
    if (filter === 'all') return effort.badges;
    return effort.badges.filter((b) => b.category === filter);
  }, [effort, filter]);

  if (!effort) {
    return (
      <div className="effort-badges">
        <p className="effort-message">Loading challenge badges…</p>
      </div>
    );
  }

  const pct = Math.round(
    (effort.earnedCount / Math.max(effort.badges.length, 1)) * 100,
  );
  const inProgress = effort.badges.filter(
    (b) =>
      !b.earned &&
      b.progress &&
      b.progress.current > 0 &&
      b.progress.current < b.progress.target,
  ).length;

  return (
    <div className="effort-badges is-modern">
      <div className="effort-hero">
        <div className="effort-hero-copy">
          <p className="effort-kicker">Challenge board</p>
          <h3>Unlock with real work</h3>
          <p className="effort-message">{effort.message}</p>
        </div>
        <div className="effort-hero-meters">
          <div
            className="effort-ring"
            style={{ ['--ring' as string]: pct }}
            title={`${effort.earnedCount} of ${effort.badges.length} unlocked`}
          >
            <strong>{effort.earnedCount}</strong>
            <span>unlocked</span>
          </div>
          <div className="effort-streak" title="Completion streak">
            <strong>{effort.streakDays}</strong>
            <span>day streak</span>
          </div>
        </div>
      </div>

      <div className="effort-filters" role="tablist" aria-label="Badge filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`effort-filter${filter === f.id ? ' is-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="effort-grid" role="list">
        {badges.map((badge, i) => (
          <BadgeCard key={badge.id} badge={badge} index={i} />
        ))}
      </div>

      <p className="effort-foot">
        {effort.earnedCount} of {effort.badges.length} unlocked
        {inProgress ? ` · ${inProgress} in progress` : ''}. Daily learning,
        consistency, and AI Spark open when you keep the habit.
      </p>
    </div>
  );
}

function BadgeCard({
  badge,
  index,
}: {
  badge: EffortBadgeDto;
  index: number;
}) {
  const pct =
    badge.progress && badge.progress.target > 0
      ? Math.min(
          100,
          Math.round((badge.progress.current / badge.progress.target) * 100),
        )
      : badge.earned
        ? 100
        : 0;
  const inProgress = !badge.earned && pct > 0 && pct < 100;

  return (
    <article
      className={`effort-badge tone-${badge.tone}${
        badge.earned ? ' is-earned' : ' is-locked'
      }${inProgress ? ' is-progress' : ''}`}
      role="listitem"
      style={{ ['--reveal-delay' as string]: `${index * 40}ms` }}
    >
      <div className="effort-badge-top">
        <div className="effort-badge-logo-wrap">
          <BadgeLogo
            id={badge.id}
            tone={badge.tone}
            earned={badge.earned}
            size={52}
            title={badge.title}
          />
          {!badge.earned ? (
            <span className="effort-lock" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect
                  x="5"
                  y="11"
                  width="14"
                  height="10"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M8 11V8a4 4 0 0 1 8 0v3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          ) : null}
        </div>
        <div className="effort-badge-body">
          <div className="effort-badge-meta">
            <span className="effort-cat">{CATEGORY_LABEL[badge.category]}</span>
            {badge.earned ? (
              <span className="effort-earned-tag">Unlocked</span>
            ) : inProgress ? (
              <span className="effort-progress-tag">In progress</span>
            ) : (
              <span className="effort-locked-tag">Locked</span>
            )}
          </div>
          <h4 className="effort-badge-title">{badge.title}</h4>
          <p>{badge.description}</p>
        </div>
      </div>

      <div className="effort-challenge">
        <span className="effort-challenge-label">Challenge</span>
        <p>{badge.challenge}</p>
      </div>

      <div className="effort-progress-row">
        <div
          className="effort-progress"
          aria-label={`Progress ${badge.progress?.current ?? 0} of ${
            badge.progress?.target ?? 1
          }`}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="effort-progress-text">
          {badge.earned
            ? 'Complete'
            : `${badge.progress?.current ?? 0}/${badge.progress?.target ?? 1}`}
        </span>
      </div>
    </article>
  );
}
