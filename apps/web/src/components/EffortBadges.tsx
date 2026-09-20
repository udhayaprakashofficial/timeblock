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

function progressPct(badge: EffortBadgeDto): number {
  if (badge.earned) return 100;
  if (!badge.progress || badge.progress.target <= 0) return 0;
  return Math.min(
    100,
    Math.round((badge.progress.current / badge.progress.target) * 100),
  );
}

function progressLabel(badge: EffortBadgeDto): string {
  if (badge.earned) return 'Complete';
  const { progress } = badge;
  if (!progress) return '0 / 1';

  if (badge.id === 'focus_zone') {
    if (progress.target === 1 && progress.current === 0) {
      return 'Over 80% — ease load';
    }
    if (progress.target === 40) {
      return `${progress.current}% · need 40–80%`;
    }
  }

  if (progress.target === 100) {
    return `${progress.current}%`;
  }

  return `${progress.current} / ${progress.target}`;
}

export function EffortBadges({
  effort,
  loading = false,
}: {
  effort?: EffortSummaryDto | null;
  loading?: boolean;
}) {
  const [filter, setFilter] = useState<'all' | EffortBadgeCategory>('all');

  const badges = useMemo(() => {
    if (!effort) return [];
    const list =
      filter === 'all'
        ? [...effort.badges]
        : effort.badges.filter((b) => b.category === filter);
    return list.sort((a, b) => {
      const rank = (badge: EffortBadgeDto) => {
        if (badge.earned) return 0;
        const pct = progressPct(badge);
        if (pct >= 100) return 1;
        if (pct > 0) return 2;
        return 3;
      };
      return rank(a) - rank(b);
    });
  }, [effort, filter]);

  if (!effort && loading) {
    return (
      <div className="effort-badges is-board" aria-busy="true">
        <div className="effort-masthead is-skeleton">
          <div className="effort-masthead-copy">
            <div className="skel skel-kicker" />
            <div className="skel skel-title" />
            <div className="skel skel-line" />
          </div>
          <div className="skel skel-ring" />
          <div className="effort-masthead-stats">
            <div className="skel skel-stat" />
            <div className="skel skel-stat" />
            <div className="skel skel-stat" />
          </div>
        </div>
        <div className="effort-toolbar">
          <div className="effort-filters">
            {FILTERS.map((f) => (
              <span key={f.id} className="skel skel-chip" />
            ))}
          </div>
        </div>
        <div className="effort-grid" role="list">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="effort-plaque is-skeleton" role="listitem">
              <div className="skel skel-pill" />
              <div className="skel skel-icon" />
              <div className="skel skel-title-sm" />
              <div className="skel skel-line" />
              <div className="skel skel-bar" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!effort) {
    return (
      <div className="effort-badges is-board">
        <p className="effort-message">Loading badges…</p>
      </div>
    );
  }

  const remaining = Math.max(0, effort.badges.length - effort.earnedCount);
  const inProgress = effort.badges.filter((b) => {
    if (b.earned) return false;
    const pct = progressPct(b);
    return pct > 0 && pct < 100;
  }).length;
  const unlockPct = Math.round(
    (effort.earnedCount / Math.max(1, effort.badges.length)) * 100,
  );

  return (
    <div className="effort-badges is-board">
      <header className="effort-masthead">
        <div className="effort-masthead-copy">
          <p className="effort-kicker">Challenge board</p>
          <h3>
            {effort.earnedCount} unlocked
            {remaining > 0 ? ` · ${remaining} left` : ''}
          </h3>
          <p className="effort-message">
            {effort.message ||
              'Proof from logged minutes and completed blocks — not participation trophies.'}
          </p>
        </div>

        <div className="effort-masthead-meter" aria-hidden>
          <div
            className="effort-ring-lg"
            style={{ ['--ring' as string]: String(unlockPct) }}
          >
            <strong>{unlockPct}%</strong>
            <span>board</span>
          </div>
        </div>

        <div className="effort-masthead-stats" aria-label="Badge stats">
          <div className="effort-stat">
            <strong>{effort.earnedCount}</strong>
            <span>Unlocked</span>
          </div>
          <div className="effort-stat is-accent">
            <strong>{effort.streakDays}</strong>
            <span>Day streak</span>
          </div>
          <div className="effort-stat">
            <strong>{inProgress}</strong>
            <span>In progress</span>
          </div>
        </div>
      </header>

      <div className="effort-toolbar">
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
        <p className="effort-count">
          {badges.length} badge{badges.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="effort-grid" role="list">
        {badges.map((badge, index) => (
          <BadgeCard key={badge.id} badge={badge} index={index} />
        ))}
        {badges.length === 0 ? (
          <p className="effort-empty">No badges in this category.</p>
        ) : null}
      </div>
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
  const pct = progressPct(badge);
  const ready = !badge.earned && pct >= 100;
  const inProgress = !badge.earned && pct > 0 && pct < 100;
  const status = badge.earned
    ? 'Unlocked'
    : ready
      ? 'Ready'
      : inProgress
        ? 'In progress'
        : 'Locked';

  return (
    <article
      className={`effort-plaque tone-${badge.tone}${
        badge.earned ? ' is-earned' : ' is-locked'
      }${inProgress ? ' is-progress' : ''}${ready ? ' is-ready' : ''}`}
      role="listitem"
      style={{ ['--reveal-delay' as string]: `${index * 40}ms` }}
    >
      <div className="effort-plaque-glow" aria-hidden />

      <div className="effort-plaque-top">
        <span
          className={`effort-status${
            badge.earned
              ? ' is-on'
              : ready
                ? ' is-ready'
                : inProgress
                  ? ' is-mid'
                  : ''
          }`}
        >
          {status}
        </span>
        <span className="effort-cat">{CATEGORY_LABEL[badge.category]}</span>
      </div>

      <div className="effort-plaque-icon">
        <BadgeLogo
          id={badge.id}
          tone={badge.tone}
          earned={badge.earned}
          size={72}
          title={badge.title}
        />
      </div>

      <div className="effort-plaque-body">
        <h4 className="effort-badge-title">{badge.title}</h4>
        <p className="effort-badge-how">{badge.challenge}</p>
      </div>

      <div className="effort-plaque-foot">
        <div className="effort-progress-row">
          <span>{progressLabel(badge)}</span>
          <strong>{pct}%</strong>
        </div>
        <div
          className="effort-progress"
          aria-label={`Progress ${badge.progress?.current ?? 0} of ${
            badge.progress?.target ?? 1
          }`}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    </article>
  );
}
