'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  UserDto,
  Weekday,
} from '@timeblock/shared-types';
import { api, detectBrowserTimeZone } from '../api';
import { CupkeyLogo } from '../components/CupkeyLogo';
import { BootProgressScreen } from '../components/BootProgressScreen';
import { useAppDispatch } from '../store/hooks';
import { clearStats } from '../store/statsSlice';
import { useTheme } from '../theme';
import './onboarding.css';

type BreakDraft = { name: string; start: string; end: string };
type PlanDraft = {
  id: string;
  name: string;
  minutes: number;
  /** Repeat on selected workdays every week */
  recurring: boolean;
};

const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const SAMPLE_PLANS: PlanDraft[] = [
  { id: 'sample-1', name: 'Plan the Day', minutes: 60, recurring: true },
  { id: 'sample-2', name: 'Reply to emails', minutes: 60, recurring: true },
  { id: 'sample-3', name: 'Finish Project Report', minutes: 60, recurring: true },
  { id: 'sample-4', name: 'Deep work session', minutes: 80, recurring: true },
];

function toHm(value: string, fallback = '09:00'): string {
  const m = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1]) || 0));
  const min = Math.min(59, Math.max(0, Number(m[2]) || 0));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function minutesOf(hm: string, fallback = '09:00'): number {
  const [h, m] = toHm(hm, fallback).split(':').map(Number);
  return h * 60 + m;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function formatHmLabel(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nextBreakSlot(
  workStart: string,
  workEnd: string,
  breaks: BreakDraft[],
  durationMins = 30,
): { start: string; end: string } {
  const dayStart = minutesOf(workStart);
  const dayEnd = minutesOf(workEnd);
  const dur = Math.max(15, durationMins);

  const sorted = [...breaks]
    .map((b) => ({
      start: minutesOf(b.start),
      end: minutesOf(b.end),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  // Place after the latest break end (or work start)
  let cursor = sorted.length ? sorted[sorted.length - 1]!.end : dayStart;

  // If that overlaps something earlier in a messy list, jump past all overlaps
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of sorted) {
      if (cursor < b.end && cursor + dur > b.start) {
        cursor = b.end;
        changed = true;
      }
    }
  }

  if (cursor + dur > dayEnd) {
    cursor = Math.max(dayStart, dayEnd - dur);
    // final overlap pass
    for (const b of sorted) {
      if (cursor < b.end && cursor + dur > b.start) {
        cursor = b.end;
      }
    }
  }

  const start = Math.min(Math.max(cursor, dayStart), Math.max(dayStart, dayEnd - dur));
  const end = Math.min(dayEnd, start + dur);
  return {
    start: formatHmLabel(start),
    end: formatHmLabel(Math.max(start + 15, end)),
  };
}

type TimelineBlock = {
  id: string;
  kind: 'break' | 'task';
  name: string;
  startMin: number;
  endMin: number;
};

/** Pack tasks into free gaps between workStart and workEnd, skipping breaks. */
function packTasksOntoDay(
  workStart: string,
  workEnd: string,
  breaks: BreakDraft[],
  plans: PlanDraft[],
): TimelineBlock[] {
  const dayStart = minutesOf(workStart);
  const dayEnd = minutesOf(workEnd);
  if (dayEnd <= dayStart) return [];

  const sortedBreaks = breaks
    .map((b) => ({
      name: b.name.trim() || 'Break',
      start: Math.max(dayStart, minutesOf(b.start, '12:00')),
      end: Math.min(dayEnd, minutesOf(b.end, '13:00')),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  const blocks: TimelineBlock[] = sortedBreaks.map((b, i) => ({
    id: `break-${i}-${b.start}`,
    kind: 'break' as const,
    name: b.name,
    startMin: b.start,
    endMin: b.end,
  }));

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = dayStart;
  for (const b of sortedBreaks) {
    if (b.start > cursor) gaps.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (dayEnd > cursor) gaps.push({ start: cursor, end: dayEnd });

  const tasks = plans.filter((p) => p.name.trim());
  let taskIdx = 0;
  for (const gap of gaps) {
    let t = gap.start;
    while (taskIdx < tasks.length && t < gap.end) {
      const plan = tasks[taskIdx]!;
      const dur = Math.max(5, Math.min(480, plan.minutes || 30));
      if (t + dur > gap.end) break;
      blocks.push({
        id: plan.id,
        kind: 'task',
        name: plan.name.trim(),
        startMin: t,
        endMin: t + dur,
      });
      t += dur;
      taskIdx += 1;
    }
  }

  return blocks.sort((a, b) => a.startMin - b.startMin);
}

function hourLabels(dayStart: number, dayEnd: number): number[] {
  const first = Math.floor(dayStart / 60);
  const last = Math.ceil(dayEnd / 60);
  const labels: number[] = [];
  for (let h = first; h <= last; h++) labels.push(h);
  return labels.length ? labels : [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
}

function OnboardDayTimeline({
  workStart,
  workEnd,
  blocks,
  emptyLabel = 'Open for work',
}: {
  workStart: string;
  workEnd: string;
  blocks: TimelineBlock[];
  emptyLabel?: string;
}) {
  const dayStart = minutesOf(workStart);
  const dayEnd = Math.max(dayStart + 60, minutesOf(workEnd));
  const span = Math.max(60, dayEnd - dayStart);
  const hours = hourLabels(dayStart, dayEnd);
  const pxPerHour = 56;
  const height = Math.max(hours.length - 1, 1) * pxPerHour;

  return (
    <div className="onboard-timeline">
      <div className="onboard-timeline-hours" style={{ height }}>
        {hours.map((h) => {
          const top = ((h * 60 - dayStart) / span) * height;
          return (
            <span
              key={h}
              className="onboard-timeline-hour"
              style={{ top: Math.max(0, top) }}
            >
              {String(h).padStart(2, '0')}:00
            </span>
          );
        })}
      </div>
      <div className="onboard-timeline-rail" style={{ height }}>
        <div className="onboard-timeline-grid" aria-hidden>
          {hours.map((h) => {
            const top = ((h * 60 - dayStart) / span) * height;
            if (top < 0 || top > height) return null;
            return (
              <i key={h} className="onboard-timeline-line" style={{ top }} />
            );
          })}
        </div>
        {!blocks.length && (
          <div className="onboard-timeline-empty">{emptyLabel}</div>
        )}
        {blocks.map((b) => {
          const top = ((b.startMin - dayStart) / span) * height;
          const blockH = Math.max(
            28,
            ((b.endMin - b.startMin) / span) * height,
          );
          return (
            <div
              key={b.id}
              className={`onboard-timeline-block is-${b.kind}`}
              style={{ top, height: blockH }}
              title={`${b.name} · ${formatHmLabel(b.startMin)}–${formatHmLabel(b.endMin)}`}
            >
              <strong>{b.name}</strong>
              <span>
                {formatHmLabel(b.startMin)}–{formatHmLabel(b.endMin)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OnboardingFlow({
  user,
  onFinished,
}: {
  user: UserDto;
  onFinished: (next: UserDto) => void;
}) {
  const qc = useQueryClient();
  const dispatch = useAppDispatch();
  const { setTheme } = useTheme();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeDays, setActiveDays] = useState<Weekday[]>([1, 2, 3, 4, 5]);
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('18:00');
  const [breaks, setBreaks] = useState<BreakDraft[]>([
    { name: 'Lunch', start: '12:30', end: '13:30' },
  ]);

  const [treatAllDayFree] = useState(true);
  const [meetingBuffer] = useState(true);

  const [plans, setPlans] = useState<PlanDraft[]>(() =>
    SAMPLE_PLANS.map((p) => ({ ...p })),
  );

  const workableMins = useMemo(() => {
    const span = Math.max(0, minutesOf(workEnd) - minutesOf(workStart));
    const breakMins = breaks.reduce(
      (sum, b) => sum + Math.max(0, minutesOf(b.end) - minutesOf(b.start)),
      0,
    );
    return Math.max(0, span - breakMins);
  }, [workStart, workEnd, breaks]);

  const targetFill = Math.round(workableMins * 0.8);

  const scheduleBlocks = useMemo(
    () =>
      packTasksOntoDay(workStart, workEnd, breaks, []).filter(
        (b) => b.kind === 'break',
      ),
    [workStart, workEnd, breaks],
  );

  const planBlocks = useMemo(
    () => packTasksOntoDay(workStart, workEnd, breaks, plans),
    [workStart, workEnd, breaks, plans],
  );

  const completeOnboarding = useMutation({
    mutationFn: async (payload: {
      createTasks: boolean;
      weekdays: Weekday[];
      workStart: string;
      workEnd: string;
      breaks: BreakDraft[];
      tasks: Array<{
        name: string;
        estimatedMinutes: number;
        recurring: boolean;
      }>;
    }) => {
      const body = {
        createTasks: payload.createTasks,
        weekdays: payload.weekdays,
        workStart: payload.workStart,
        workEnd: payload.workEnd,
        breaks: payload.breaks
          .filter((b) => b.name.trim())
          .map((b) => ({
            name: b.name.trim(),
            start: toHm(b.start, '12:00'),
            end: toHm(b.end, '13:00'),
          })),
        tasks: payload.tasks,
        timezone: detectBrowserTimeZone(),
      };

      try {
        const result = await api.post<{ user: UserDto; tasks: unknown[] }>(
          '/api/users/me/finish-onboarding',
          body,
        );
        return { ...result.user, onboardingCompleted: true as const };
      } catch (primaryErr) {
        // Never trap the user on onboarding if the one-shot call drops
        // (proxy timeout / Failed to fetch). Mark complete via PATCH, then
        // best-effort schedule + tasks.
        console.warn(
          '[onboarding] finish-onboarding failed, falling back',
          primaryErr instanceof Error ? primaryErr.message : primaryErr,
        );
        const next = await api.patch<UserDto>('/api/users/me', {
          onboardingCompleted: true,
          theme: 'dark',
          timezone: detectBrowserTimeZone(),
        });

        try {
          await Promise.all(
            payload.weekdays.map((weekday) =>
              api.put('/api/schedule', {
                weekday,
                workStart: payload.workStart,
                workEnd: payload.workEnd,
                breaks: body.breaks,
              }),
            ),
          );
        } catch {
          /* schedule can be set later in Settings */
        }

        if (payload.createTasks && payload.tasks.length) {
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: detectBrowserTimeZone(),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date());
          await Promise.all(
            payload.tasks.map(async (t) => {
              try {
                await api.post('/api/tasks', {
                  date: today,
                  name: t.name,
                  estimatedMinutes: t.estimatedMinutes,
                });
              } catch {
                /* keep going */
              }
            }),
          );
        }

        return { ...next, onboardingCompleted: true as const, theme: 'dark' as const };
      }
    },
    onSuccess: (next) => {
      try {
        localStorage.setItem(`tb.onboardingDone.${user.id}`, '1');
        sessionStorage.setItem(`tb.onboardingDone.${user.id}`, '1');
      } catch {
        /* ignore */
      }
      // Dashboard defaults to dark after onboarding (onboarding UI stays light).
      setTheme('dark');
      dispatch(clearStats());
      qc.setQueryData(['me'], { ...next, theme: 'dark' as const });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      onFinished({ ...next, theme: 'dark' });
    },
  });

  const finish = async (alsoCreateTasks: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const weekdays = (activeDays.length
        ? activeDays
        : ([1, 2, 3, 4, 5] as Weekday[]));
      try {
        sessionStorage.setItem(
          `tb.onboard.prefs.${user.id}`,
          JSON.stringify({ treatAllDayFree, meetingBuffer }),
        );
      } catch {
        /* ignore */
      }
      await completeOnboarding.mutateAsync({
        createTasks: alsoCreateTasks,
        weekdays,
        workStart: toHm(workStart),
        workEnd: toHm(workEnd),
        breaks,
        tasks: plans
          .map((p) => ({
            name: p.name.trim(),
            estimatedMinutes: Math.max(5, Math.min(480, p.minutes || 30)),
            recurring: Boolean(p.recurring),
          }))
          .filter((p) => p.name),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup');
      setBusy(false);
    }
  };

  const skipAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding.mutateAsync({
        createTasks: false,
        weekdays: activeDays.length ? activeDays : ([1, 2, 3, 4, 5] as Weekday[]),
        workStart: toHm(workStart),
        workEnd: toHm(workEnd),
        breaks,
        tasks: [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not skip setup');
      setBusy(false);
    }
  };

  const toggleDay = (d: Weekday) => {
    setActiveDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  };

  return (
    <div className={`onboard-screen${step === 2 ? ' is-finale' : ''}`}>
      {busy && <BootProgressScreen variant="onboard" />}
      <header className="onboard-top">
        <CupkeyLogo size={26} title="Cupkey" />
        <div className="onboard-progress" aria-hidden>
          <span className={step >= 1 ? 'is-done' : ''} />
          <span className={step >= 2 ? 'is-done' : ''} />
        </div>
        <div className="onboard-step-label">Step {step} of 2</div>
        {step < 2 ? (
          <button
            type="button"
            className="btn btn-ghost onboard-skip"
            disabled={busy}
            onClick={() => void skipAll()}
          >
            Skip
          </button>
        ) : (
          <span className="onboard-skip-spacer" />
        )}
      </header>

      {step === 1 && (
        <div className="onboard-grid">
          <div className="onboard-main">
            <h1>
              When does your
              <br />
              day actually run?
            </h1>
            <p className="onboard-sub">
              Set it once. Cupkey packs tasks only inside these hours and never
              books over a break.
            </p>

            <div className="onboard-days">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  className={`onboard-day${activeDays.includes(d.value) ? ' is-on' : ''}`}
                  onClick={() => toggleDay(d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <div className="onboard-hours">
              <label>
                <span>Work starts</span>
                <input
                  type="time"
                  value={workStart}
                  onChange={(e) => setWorkStart(toHm(e.target.value))}
                />
              </label>
              <label>
                <span>Work ends</span>
                <input
                  type="time"
                  value={workEnd}
                  onChange={(e) => setWorkEnd(toHm(e.target.value))}
                />
              </label>
            </div>

            <div className="onboard-breaks-label">Breaks that repeat</div>
            <div className="onboard-breaks">
              {breaks.map((b, i) => (
                <div key={i} className="onboard-break-row">
                  <input
                    className="onboard-break-name"
                    value={b.name}
                    onChange={(e) => {
                      const next = [...breaks];
                      next[i] = { ...b, name: e.target.value };
                      setBreaks(next);
                    }}
                    placeholder="Break name"
                  />
                  <input
                    type="time"
                    value={b.start}
                    onChange={(e) => {
                      const next = [...breaks];
                      next[i] = { ...b, start: toHm(e.target.value) };
                      setBreaks(next);
                    }}
                  />
                  <span className="onboard-break-sep">—</span>
                  <input
                    type="time"
                    value={b.end}
                    onChange={(e) => {
                      const next = [...breaks];
                      next[i] = { ...b, end: toHm(e.target.value) };
                      setBreaks(next);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setBreaks(breaks.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary onboard-add-break"
                onClick={() => {
                  const slot = nextBreakSlot(workStart, workEnd, breaks);
                  setBreaks([
                    ...breaks,
                    { name: 'Break', start: slot.start, end: slot.end },
                  ]);
                }}
              >
                + Add a break
              </button>
            </div>

            <div className="onboard-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || minutesOf(workEnd) <= minutesOf(workStart)}
                onClick={() => setStep(2)}
              >
                Continue →
              </button>
              <span className="onboard-hint">
                You can fine-tune any single day later.
              </span>
            </div>
          </div>

          <aside className="onboard-preview">
            <div className="onboard-preview-head">
              <span>Live preview</span>
              <span>{formatDuration(workableMins)} workable</span>
            </div>
            <h3>A typical weekday</h3>
            <OnboardDayTimeline
              workStart={workStart}
              workEnd={workEnd}
              blocks={scheduleBlocks}
              emptyLabel="Open for work — add breaks to see them here"
            />
            <div className="onboard-preview-tip">
              Aim to fill about <b>{formatDuration(targetFill)}</b> of this.
              Anything over 80% and the first surprise of the day breaks the
              plan.
            </div>
          </aside>
        </div>
      )}

      {step === 2 && (
        <div className="onboard-grid is-finale-grid">
          <div className="onboard-main">
            <p className="onboard-kicker">You&apos;re set up</p>
            <h1>
              Write down three
              <br />
              things. We&apos;ll find
              <br />
              the room.
            </h1>
            <p className="onboard-sub is-light">
              Starter tasks for your weekdays — edit or remove any. Turn on
              Repeat to create them every selected workday from now on.
            </p>

            <div className="onboard-plan-list">
              {plans.map((p) => (
                <div key={p.id} className="onboard-plan-row">
                  <input
                    value={p.name}
                    placeholder="Task name"
                    onChange={(e) => {
                      setPlans((prev) =>
                        prev.map((row) =>
                          row.id === p.id
                            ? { ...row, name: e.target.value }
                            : row,
                        ),
                      );
                    }}
                  />
                  <input
                    className="onboard-plan-mins"
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    value={p.minutes}
                    onChange={(e) => {
                      setPlans((prev) =>
                        prev.map((row) =>
                          row.id === p.id
                            ? {
                                ...row,
                                minutes: Math.max(
                                  5,
                                  Number(e.target.value) || 30,
                                ),
                              }
                            : row,
                        ),
                      );
                    }}
                  />
                  <span className="onboard-plan-unit">Min</span>
                  <label className="onboard-plan-recur" title="Repeat on your workdays">
                    <input
                      type="checkbox"
                      checked={p.recurring}
                      onChange={(e) => {
                        setPlans((prev) =>
                          prev.map((row) =>
                            row.id === p.id
                              ? { ...row, recurring: e.target.checked }
                              : row,
                          ),
                        );
                      }}
                    />
                    Repeat
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost onboard-plan-remove"
                    aria-label={`Remove ${p.name || 'task'}`}
                    title="Remove"
                    onClick={() =>
                      setPlans((prev) => prev.filter((row) => row.id !== p.id))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {plans.length < 6 && (
                <button
                  type="button"
                  className="btn btn-secondary onboard-add-plan"
                  onClick={() =>
                    setPlans((prev) => [
                      ...prev,
                      {
                        id: `custom-${Date.now()}`,
                        name: '',
                        minutes: 30,
                        recurring: true,
                      },
                    ])
                  }
                >
                  + Add a task
                </button>
              )}
            </div>

            <div className="onboard-actions">
              <button
                type="button"
                className="btn btn-primary onboard-finale-cta"
                disabled={busy || plans.every((p) => !p.name.trim())}
                onClick={() => void finish(true)}
              >
                {busy ? 'Building…' : 'Build my day →'}
              </button>
            </div>
            {error && <p className="onboard-error">{error}</p>}
          </div>

          <aside className="onboard-preview">
            <div className="onboard-preview-head">
              <span>Your first plan</span>
              <span className="is-accent">
                {plans.filter((p) => p.name.trim()).length} tasks
              </span>
            </div>
            <OnboardDayTimeline
              workStart={workStart}
              workEnd={workEnd}
              blocks={planBlocks}
              emptyLabel="Add a named task to place it on the day"
            />
          </aside>
        </div>
      )}

      {error && step !== 2 && <p className="onboard-error">{error}</p>}
    </div>
  );
}
