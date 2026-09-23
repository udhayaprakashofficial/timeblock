'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShareBadgePayload, ShareWeekPayload } from './shareFormat';
import {
  formatDrift,
  formatHm,
} from './shareFormat';
import { downloadNodePng } from './downloadPng';
import { CloseIcon, DownloadIcon } from './ShareIcons';
import { onAvatarChange, readAvatar } from '../user-avatar';
import { useAppUserOptional } from '../../user-context';
import './share.css';

export type ShareTab =
  | 'linkedin'
  | 'wrapped'
  | 'story'
  | 'square'
  | 'badge';

type Props = {
  open: boolean;
  onClose: () => void;
  week: ShareWeekPayload | null;
  badge?: ShareBadgePayload | null;
  initialTab?: ShareTab;
};

type SharePerson = {
  name: string;
  photo: string | null;
};

function useSharePerson(): SharePerson | null {
  const user = useAppUserOptional();
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setPhoto(null);
      return;
    }
    setPhoto(readAvatar(user.id));
    return onAvatarChange(() => setPhoto(readAvatar(user.id)));
  }, [user?.id]);

  if (!user?.name?.trim()) return null;
  return { name: user.name.trim(), photo };
}

function initialsFrom(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function PersonRow({
  person,
  tone = 'light',
}: {
  person: SharePerson;
  tone?: 'light' | 'dark';
}) {
  return (
    <div className={`share-person share-person-${tone}`}>
      <div className="share-person-avatar" aria-hidden>
        {person.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={person.photo} alt="" />
        ) : (
          <span>{initialsFrom(person.name)}</span>
        )}
      </div>
      <div className="share-person-meta">
        <strong>{person.name}</strong>
        <span>cupkey.io</span>
      </div>
    </div>
  );
}

export function ShareStudio({
  open,
  onClose,
  week,
  badge,
  initialTab = 'linkedin',
}: Props) {
  const [tab, setTab] = useState<ShareTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const person = useSharePerson();

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  const tabs: Array<{ id: ShareTab; label: string; need: 'week' | 'badge' }> = [
    { id: 'linkedin', label: 'LinkedIn', need: 'week' },
    { id: 'wrapped', label: 'Wrapped', need: 'week' },
    { id: 'story', label: 'Story', need: 'week' },
    { id: 'square', label: 'Square', need: 'week' },
    { id: 'badge', label: 'Badge', need: 'badge' },
  ];

  const visible = tabs.filter((t) =>
    t.need === 'badge' ? Boolean(badge) : Boolean(week),
  );
  const active = visible.some((t) => t.id === tab)
    ? tab
    : (visible[0]?.id ?? 'linkedin');

  const onDownload = async () => {
    const node = stageRef.current?.querySelector(
      '[data-share-card]',
    ) as HTMLElement | null;
    if (!node) return;
    setBusy(true);
    setErr(null);
    try {
      await downloadNodePng(node, `cupkey-${active}-${Date.now()}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not export image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-studio" role="dialog" aria-modal="true" aria-label="Share">
      <button type="button" className="share-studio-backdrop" aria-label="Close" onClick={onClose} />
      <div className="share-studio-panel">
        <header className="share-studio-head">
          <div>
            <p className="share-kicker">Share</p>
            <h2>Export a creative</h2>
          </div>
          <button type="button" className="share-close" onClick={onClose}>
            <CloseIcon size={14} />
            Close
          </button>
        </header>

        <nav className="share-tabs" aria-label="Creative format">
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              className={active === t.id ? 'is-active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="share-stage" ref={stageRef}>
          {active === 'linkedin' && week ? (
            <LinkedInCard week={week} person={person} />
          ) : null}
          {active === 'wrapped' && week ? (
            <WrappedCard week={week} person={person} />
          ) : null}
          {active === 'story' && week ? (
            <StoryCard week={week} person={person} />
          ) : null}
          {active === 'square' && week ? (
            <SquareCard week={week} person={person} />
          ) : null}
          {active === 'badge' && badge ? (
            <BadgeCard badge={badge} person={person} />
          ) : null}
        </div>

        <footer className="share-studio-foot">
          {err ? <p className="share-err">{err}</p> : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void onDownload()}
          >
            <DownloadIcon size={15} />
            {busy ? 'Preparing…' : 'Download PNG'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Mark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/cupkey-mark.png" alt="" className="share-mark" width={28} height={28} />
  );
}

function LinkedInCard({
  week,
  person,
}: {
  week: ShareWeekPayload;
  person: SharePerson | null;
}) {
  const max = Math.max(1, ...week.days.map((d) => d.actualMinutes));
  const best = week.days.reduce(
    (a, b) => (b.actualMinutes > a.actualMinutes ? b : a),
    week.days[0] ?? { actualMinutes: 0, label: '' },
  );
  return (
    <div className="share-card share-linkedin" data-share-card>
      <div className="share-linkedin-copy">
        <p className="share-eyebrow">{week.weekLabel}</p>
        {person ? <PersonRow person={person} tone="light" /> : null}
        <h3>
          {formatHm(week.actualMinutes)} of
          <br />
          work I can
          <br />
          actually
          <br />
          account for.
        </h3>
        <p className="share-lede">
          {week.completed} tasks shipped, estimates off by{' '}
          {Math.abs(week.driftMinutes)} minutes across the week
          {week.completionPercent >= 80 ? ', and strong completion.' : '.'}
        </p>
        <div className="share-brand-row">
          <Mark />
          <span>cupkey.io</span>
        </div>
      </div>
      <div className="share-linkedin-bars">
        {week.days.map((d) => {
          const pct = Math.round((d.actualMinutes / max) * 100);
          const isBest = d.label === best.label && d.actualMinutes > 0;
          return (
            <div key={d.date} className={`share-bar-row${isBest ? ' is-best' : ''}`}>
              <span>{d.label.slice(0, 3)}</span>
              <div className="share-bar-track">
                <i style={{ width: `${pct}%` }} />
              </div>
              <em>{formatHm(d.actualMinutes)}</em>
            </div>
          );
        })}
        <div className="share-stat-grid">
          <div>
            <strong>{week.completed}</strong>
            <span>Shipped</span>
          </div>
          <div>
            <strong className="is-flare">{week.streakDays ?? '—'}</strong>
            <span>Day streak</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function WrappedCard({
  week,
  person,
}: {
  week: ShareWeekPayload;
  person: SharePerson | null;
}) {
  const hours = Math.round(week.actualMinutes / 60);
  return (
    <div className="share-card share-wrapped" data-share-card>
      <p className="share-eyebrow">Cupkey Wrapped · {new Date().getFullYear()}</p>
      {person ? <PersonRow person={person} tone="dark" /> : null}
      <p className="share-sub">Your week, in minutes you actually logged</p>
      <div className="share-wrapped-hero">
        <span>You spent</span>
        <strong>{hours.toLocaleString()}</strong>
        <p>
          hours doing the
          <br />
          thing, not
          <br />
          planning to.
        </p>
      </div>
      <div className="share-wrapped-rows">
        <div>
          <span>Longest streak</span>
          <strong>{week.streakDays ?? 0} days</strong>
        </div>
        <div>
          <span>Tasks shipped</span>
          <strong>{week.completed}</strong>
        </div>
        <div>
          <span>Estimate accuracy</span>
          <strong>{week.accuracyPercent}%</strong>
        </div>
        <div className="is-ink">
          <span>Drift</span>
          <strong>{formatDrift(week.driftMinutes)}</strong>
        </div>
      </div>
      <div className="share-brand-row is-end">
        <Mark />
        <span>cupkey.io/wrapped</span>
      </div>
    </div>
  );
}

function StoryCard({
  week,
  person,
}: {
  week: ShareWeekPayload;
  person: SharePerson | null;
}) {
  const max = Math.max(1, ...week.days.map((d) => d.actualMinutes));
  const best = week.days.reduce(
    (a, b) => (b.actualMinutes > a.actualMinutes ? b : a),
    week.days[0] ?? { label: '', actualMinutes: 0, date: '' },
  );
  const hours = Math.floor(week.actualMinutes / 60);
  const mins = week.actualMinutes % 60;

  return (
    <div className="share-card share-story" data-share-card>
      <div className="share-story-hero">
        <div className="share-story-stamp">
          <Mark />
          <span>Cupkey · Story</span>
        </div>
        {person ? <PersonRow person={person} tone="dark" /> : null}
        <p className="share-story-week">{week.weekLabel}</p>
        <div className="share-story-time" aria-label={formatHm(week.actualMinutes)}>
          <strong>{hours}</strong>
          <span>h</span>
          <strong className="is-mins">{String(mins).padStart(2, '0')}</strong>
          <span>m</span>
        </div>
        <h3>
          of work that
          <br />
          actually
          <br />
          happened.
        </h3>
      </div>

      <div className="share-story-body">
        <p className="share-story-caption">Your week as logged minutes</p>
        <div className="share-story-skyline" aria-hidden>
          {week.days.map((d) => {
            const pct = Math.max(8, Math.round((d.actualMinutes / max) * 100));
            const isBest = d.date === best.date && d.actualMinutes > 0;
            return (
              <div
                key={d.date}
                className={`share-story-tower${isBest ? ' is-best' : ''}`}
              >
                <div className="share-story-tower-bar" style={{ height: `${pct}%` }}>
                  {isBest ? <em>BEST</em> : null}
                </div>
                <span>{d.label.slice(0, 1)}</span>
              </div>
            );
          })}
        </div>

        <div className="share-story-strip">
          <div>
            <strong>{week.completed}</strong>
            <span>Shipped</span>
          </div>
          <div>
            <strong>{week.accuracyPercent}%</strong>
            <span>Accuracy</span>
          </div>
          <div>
            <strong>{best.label.slice(0, 3) || '—'}</strong>
            <span>Peak day</span>
          </div>
        </div>

        <div className="share-story-foot">
          <span>cupkey.io</span>
        </div>
      </div>
    </div>
  );
}

function SquareCard({
  week,
  person,
}: {
  week: ShareWeekPayload;
  person: SharePerson | null;
}) {
  const max = Math.max(1, ...week.days.map((d) => d.actualMinutes));
  return (
    <div className="share-card share-square" data-share-card>
      <div className="share-square-top">
        <p className="share-eyebrow">Week shipped</p>
        <span className="share-square-mark" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
          </svg>
        </span>
      </div>
      {person ? <PersonRow person={person} tone="dark" /> : null}
      <strong className="share-square-num">{week.completed}</strong>
      <p className="share-square-line">tasks closed in</p>
      <p className="share-square-focus">
        <span className="share-square-pill">{formatHm(week.actualMinutes)}</span>
        <span className="share-square-focus-tail">of focus</span>
      </p>
      <div className="share-square-rail" aria-hidden>
        {week.days.map((d) => {
          const pct = Math.max(14, Math.round((d.actualMinutes / max) * 100));
          return <i key={d.date} style={{ height: `${pct}%` }} />;
        })}
      </div>
        <div className="share-square-foot">
        <span>cupkey.io</span>
      </div>
    </div>
  );
}

function BadgeCard({
  badge,
  person,
}: {
  badge: ShareBadgePayload;
  person: SharePerson | null;
}) {
  const days = badge.days?.length
    ? badge.days
    : ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  return (
    <div className="share-card share-badge" data-share-card>
      <div className="share-badge-top">
        <div className="share-badge-icon" aria-hidden>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
          </svg>
        </div>
        <div>
          <p className="share-eyebrow">Badge unlocked</p>
          <h3>{badge.title}</h3>
        </div>
      </div>
      {person ? <PersonRow person={person} tone="dark" /> : null}
      <p className="share-lede">{badge.body}</p>
      <div className="share-badge-days">
        {days.map((d, i) => (
          <span key={`${d}-${i}`} className={i === days.length - 1 ? 'is-flare' : ''}>
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}
