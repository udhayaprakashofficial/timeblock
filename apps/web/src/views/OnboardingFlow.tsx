'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  DailyScheduleTemplateDto,
  UpsertScheduleTemplateDto,
  UserDto,
  Weekday,
} from '@timeblock/shared-types';
import { api } from '../api';
import { CupkeyLogo } from '../components/CupkeyLogo';
import './onboarding.css';

type BreakDraft = { name: string; start: string; end: string };
type PlanDraft = { id: string; name: string; minutes: number };

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
  { id: 'sample-1', name: 'Morning triage', minutes: 30 },
  { id: 'sample-2', name: 'Deep work block', minutes: 90 },
  { id: 'sample-3', name: 'Reply to investor thread', minutes: 30 },
  { id: 'sample-4', name: 'Weekly planning', minutes: 45 },
];

function toHm(value: string, fallback = '09:00'): string {
  const m = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1]) || 0));
  const min = Math.min(59, Math.max(0, Number(m[2]) || 0));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function minutesOf(hm: string): number {
  const [h, m] = toHm(hm).split(':').map(Number);
  return h * 60 + m;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function OnboardingFlow({
  user,
  onFinished,
}: {
  user: UserDto;
  onFinished: (next: UserDto) => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeDays, setActiveDays] = useState<Weekday[]>([1, 2, 3, 4, 5]);
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('18:00');
  const [breaks, setBreaks] = useState<BreakDraft[]>([
    { name: 'Lunch', start: '12:30', end: '13:30' },
  ]);

  const [treatAllDayFree, setTreatAllDayFree] = useState(true);
  const [meetingBuffer, setMeetingBuffer] = useState(true);

  const [plans, setPlans] = useState<PlanDraft[]>(() =>
    SAMPLE_PLANS.map((p) => ({ ...p })),
  );

  const googleConnected = user.connectedProviders.includes('google');

  const workableMins = useMemo(() => {
    const span = Math.max(0, minutesOf(workEnd) - minutesOf(workStart));
    const breakMins = breaks.reduce(
      (sum, b) => sum + Math.max(0, minutesOf(b.end) - minutesOf(b.start)),
      0,
    );
    return Math.max(0, span - breakMins);
  }, [workStart, workEnd, breaks]);

  const targetFill = Math.round(workableMins * 0.8);

  const saveSchedule = async () => {
    const days = activeDays.length ? activeDays : ([1, 2, 3, 4, 5] as Weekday[]);
    const body: Omit<UpsertScheduleTemplateDto, 'weekday'> = {
      workStart: toHm(workStart),
      workEnd: toHm(workEnd),
      breaks: breaks
        .filter((b) => b.name.trim())
        .map((b) => ({
          name: b.name.trim(),
          start: toHm(b.start, '12:00'),
          end: toHm(b.end, '13:00'),
        })),
    };
    // Apply to selected weekdays; clear weekends if not selected by writing off hours? Skip.
    const weekdays: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
    for (const weekday of weekdays) {
      if (!days.includes(weekday)) continue;
      await api.put<DailyScheduleTemplateDto>('/api/schedule', {
        ...body,
        weekday,
      });
    }
  };

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      const next = await api.patch<UserDto>('/api/users/me', {
        onboardingCompleted: true,
      });
      return { ...next, onboardingCompleted: true };
    },
    onSuccess: (next) => {
      qc.setQueryData(['me'], next);
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      onFinished(next);
    },
  });

  const finish = async (alsoCreateTasks: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await saveSchedule();
      if (alsoCreateTasks) {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        const date = `${y}-${m}-${d}`;
        for (const p of plans) {
          const name = p.name.trim();
          if (!name) continue;
          try {
            await api.post('/api/tasks', {
              date,
              name,
              estimatedMinutes: Math.max(5, Math.min(480, p.minutes || 30)),
            });
          } catch {
            /* keep going */
          }
        }
      }
      // Persist calendar prefs locally for Settings later
      try {
        sessionStorage.setItem(
          `tb.onboard.prefs.${user.id}`,
          JSON.stringify({ treatAllDayFree, meetingBuffer }),
        );
      } catch {
        /* ignore */
      }
      await completeOnboarding.mutateAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup');
    } finally {
      setBusy(false);
    }
  };

  const skipAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding.mutateAsync();
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
    <div className={`onboard-screen${step === 3 ? ' is-finale' : ''}`}>
      <header className="onboard-top">
        <CupkeyLogo size={26} title="Cupkey" />
        <div className="onboard-progress" aria-hidden>
          <span className={step >= 1 ? 'is-done' : ''} />
          <span className={step >= 2 ? 'is-done' : ''} />
          <span className={step >= 3 ? 'is-done' : ''} />
        </div>
        <div className="onboard-step-label">Step {step} of 3</div>
        {step < 3 ? (
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
                onClick={() =>
                  setBreaks([
                    ...breaks,
                    { name: 'Break', start: '15:30', end: '16:00' },
                  ])
                }
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
                Apply to all weekdays →
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
            <div className="onboard-preview-day">
              <div className="onboard-preview-hours">
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i}>{String(9 + i).padStart(2, '0')}</span>
                ))}
              </div>
              <div className="onboard-preview-rail">
                <div className="onboard-preview-open">
                  OPEN FOR WORK · {formatDuration(Math.max(0, workableMins))}
                </div>
                {breaks.slice(0, 2).map((b) => (
                  <div key={b.name + b.start} className="onboard-preview-break">
                    {b.name.toUpperCase() || 'BREAK'}
                  </div>
                ))}
              </div>
            </div>
            <div className="onboard-preview-tip">
              Aim to fill about <b>{formatDuration(targetFill)}</b> of this.
              Anything over 80% and the first surprise of the day breaks the
              plan.
            </div>
          </aside>
        </div>
      )}

      {step === 2 && (
        <div className="onboard-grid">
          <div className="onboard-main">
            <h1>
              Bring the meetings
              <br />
              you can&apos;t move.
            </h1>
            <p className="onboard-sub">
              Read-only. Cupkey never writes to your calendar unless you turn on
              two-way sync in Settings.
            </p>

            <div className="onboard-cal-list">
              <div
                className={`onboard-cal-row${googleConnected ? ' is-connected' : ''}`}
              >
                <span className="onboard-cal-icon" aria-hidden>
                  G
                </span>
                <div className="onboard-cal-copy">
                  <strong>Google Calendar</strong>
                  <span>
                    {googleConnected
                      ? `${user.email} · connected`
                      : 'Import meetings into your day'}
                  </span>
                </div>
                {googleConnected ? (
                  <span className="onboard-cal-status">Connected</span>
                ) : (
                  <a
                    className="btn btn-primary"
                    href="/api/auth/google?returnTo=/onboarding"
                  >
                    Connect
                  </a>
                )}
              </div>
              <div className="onboard-cal-row is-soon">
                <span className="onboard-cal-icon" aria-hidden>
                  O
                </span>
                <div className="onboard-cal-copy">
                  <strong>Outlook</strong>
                  <span>Work account</span>
                </div>
                <span className="coming-soon-tag">Coming soon</span>
              </div>
              <div className="onboard-cal-row is-soon">
                <span className="onboard-cal-icon" aria-hidden>
                  A
                </span>
                <div className="onboard-cal-copy">
                  <strong>Apple Calendar</strong>
                  <span>Coming soon</span>
                </div>
              </div>
            </div>

            <div className="onboard-checks">
              <label>
                <input
                  type="checkbox"
                  checked={treatAllDayFree}
                  onChange={(e) => setTreatAllDayFree(e.target.checked)}
                />
                Treat all-day events as free time
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={meetingBuffer}
                  onChange={(e) => setMeetingBuffer(e.target.checked)}
                />
                Block 10 minutes of buffer after every meeting
              </label>
            </div>

            <div className="onboard-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => setStep(3)}
              >
                Continue →
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setStep(3)}
              >
                I&apos;ll do this later
              </button>
            </div>
          </div>

          <aside className="onboard-preview">
            <div className="onboard-preview-head">
              <span>What we pull in</span>
            </div>
            <h3>Your meetings stay fixed</h3>
            <p className="onboard-preview-note">
              Connected calendars land on the timeline as locked blocks. Tasks
              fill the gaps around them.
            </p>
            <div className="onboard-preview-stats">
              <div>
                <strong>{googleConnected ? 'Ready' : 'Optional'}</strong>
                <span>Google Calendar</span>
              </div>
              <div>
                <strong>{formatDuration(workableMins)}</strong>
                <span>Yours to spend</span>
              </div>
            </div>
          </aside>
        </div>
      )}

      {step === 3 && (
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
              Four starter tasks are ready — edit, delete any you don&apos;t
              want, then build the day. Cupkey places them in the first free
              slots.
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
                  <span className="onboard-plan-unit">m</span>
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

          <aside className="onboard-preview is-dark">
            <div className="onboard-preview-head">
              <span>Your first plan</span>
              <span className="is-accent">
                {plans.filter((p) => p.name.trim()).length} tasks
              </span>
            </div>
            <div className="onboard-finale-cards">
              {plans
                .filter((p) => p.name.trim())
                .map((p) => (
                  <div key={p.id} className="onboard-finale-card">
                    <strong>{p.name.trim()}</strong>
                    <span>{p.minutes}m</span>
                  </div>
                ))}
              {plans.every((p) => !p.name.trim()) ? (
                <div className="onboard-finale-card is-muted">
                  <strong>No tasks yet — add or keep a sample</strong>
                  <span>—</span>
                </div>
              ) : (
                <div className="onboard-finale-card is-muted">
                  <strong>Open space kept for the day</strong>
                  <span>Healthy</span>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {error && step !== 3 && <p className="onboard-error">{error}</p>}
    </div>
  );
}
