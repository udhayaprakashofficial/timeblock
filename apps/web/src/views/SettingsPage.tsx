'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DailyScheduleTemplateDto,
  UpsertScheduleTemplateDto,
  UserDto,
  Weekday,
} from '@timeblock/shared-types';
import { api } from '../api';
import { useTheme } from '../theme';

const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Normalize any time string to HH:mm for native `type="time"`. */
function toHm(value: string | null | undefined, fallback = '09:00'): string {
  const raw = (value ?? '').trim();
  if (!raw) return fallback;

  const iso = raw.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2]);
    const mer = ampm[3]?.toUpperCase();
    if (mer === 'PM' && h < 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
    return `${String(Math.min(23, Math.max(0, h))).padStart(2, '0')}:${String(
      Math.min(59, Math.max(0, m)),
    ).padStart(2, '0')}`;
  }

  const parts = raw.split(':');
  if (parts.length >= 2) {
    const h = Math.min(23, Math.max(0, Number(parts[0]) || 0));
    const m = Math.min(59, Math.max(0, Number(parts[1]) || 0));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return fallback;
}

function minutesOfHm(hm: string) {
  const [h, m] = toHm(hm).split(':').map(Number);
  return h * 60 + m;
}

function TimeInput({
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  'aria-label'?: string;
}) {
  const { theme } = useTheme();
  const hm = toHm(value);

  return (
    <input
      type="time"
      className="settings-time-input"
      value={hm}
      step={60}
      aria-label={ariaLabel}
      style={{ colorScheme: theme === 'dark' ? 'dark' : 'light' }}
      onChange={(e) => {
        const next = e.target.value;
        if (/^\d{2}:\d{2}$/.test(next)) onChange(next);
      }}
      onBlur={(e) => {
        const next = e.target.value;
        if (/^\d{2}:\d{2}$/.test(next)) onChange(next);
      }}
    />
  );
}

type BreakDraft = { name: string; start: string; end: string };

function templateFingerprint(t?: DailyScheduleTemplateDto | null) {
  if (!t) return 'none';
  const breaks = (t.breaks ?? [])
    .map((b) => `${b.name}|${toHm(b.start)}|${toHm(b.end)}`)
    .join(';');
  return `${t.id}|${toHm(t.workStart)}|${toHm(t.workEnd)}|${breaks}`;
}

export function SettingsPage({ user }: { user: UserDto }) {
  const qc = useQueryClient();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [defaultTaskMinutes, setDefaultTaskMinutes] = useState(
    String(user.defaultTaskMinutes ?? 30),
  );

  useEffect(() => {
    setName(user.name);
    setEmail(user.email);
    setDefaultTaskMinutes(String(user.defaultTaskMinutes ?? 30));
  }, [user.id, user.name, user.email, user.defaultTaskMinutes]);

  const scheduleQ = useQuery({
    queryKey: ['schedule'],
    queryFn: async () => {
      const rows = await api.get<DailyScheduleTemplateDto[]>('/api/schedule');
      return Array.isArray(rows) ? rows : [];
    },
    retry: 2,
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      api.patch<UserDto>('/api/users/me', {
        name: name.trim(),
        email: email.trim(),
        defaultTaskMinutes: Math.max(
          5,
          Math.min(240, Number(defaultTaskMinutes) || 30),
        ),
      }),
    onSuccess: (next) => {
      qc.setQueryData(['me'], next);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const sync = useMutation({
    mutationFn: () =>
      api.post<{ synced: string[]; warning?: string }>('/api/calendar/sync'),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['events'] }),
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['stats'] }),
        qc.invalidateQueries({ queryKey: ['me'] }),
      ]);
    },
  });

  const byWeekday = useMemo(() => {
    const map = new Map<number, DailyScheduleTemplateDto>();
    for (const t of scheduleQ.data ?? []) map.set(t.weekday, t);
    return map;
  }, [scheduleQ.data]);

  const connected = user.connectedProviders.length
    ? user.connectedProviders.join(', ')
    : 'None connected';

  const patchScheduleCache = (saved: DailyScheduleTemplateDto) => {
    qc.setQueryData<DailyScheduleTemplateDto[]>(['schedule'], (old) => {
      const list = Array.isArray(old) ? [...old] : [];
      const idx = list.findIndex((t) => t.weekday === saved.weekday);
      if (idx >= 0) list[idx] = saved;
      else list.push(saved);
      return list.sort((a, b) => a.weekday - b.weekday);
    });
  };

  return (
    <div className="settings-page">
      <header className="settings-hero">
        <div>
          <p className="settings-kicker">Account</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">
            Profile, calendars, and the hours Cupkey uses to place new tasks.
          </p>
        </div>
      </header>

      <div className="settings-stack">
        <section className="settings-panel settings-profile">
          <div className="settings-panel-head">
            <div className="settings-avatar" aria-hidden>
              {initials(name || user.name)}
            </div>
            <div>
              <p className="settings-kicker">Profile</p>
              <h2 className="settings-panel-title">
                {name.trim() || user.name || 'Your profile'}
              </h2>
              <p className="settings-meta">
                {user.timezone || 'UTC'} · {user.email}
              </p>
            </div>
          </div>

          <div className="settings-fields">
            <label className="settings-field">
              <span>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
              />
            </label>
            <label className="settings-field">
              <span>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                type="email"
              />
            </label>
            <label className="settings-field settings-field-narrow">
              <span>Default task</span>
              <div className="settings-inline">
                <input
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={defaultTaskMinutes}
                  onChange={(e) => setDefaultTaskMinutes(e.target.value)}
                  aria-label="Default task duration in minutes"
                />
                <em>min</em>
              </div>
            </label>
          </div>

          <div className="settings-panel-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={saveProfile.isPending}
              onClick={() => saveProfile.mutate()}
            >
              {saveProfile.isPending ? 'Saving…' : 'Save profile'}
            </button>
            {saveProfile.isSuccess && (
              <p className="settings-toast is-ok">Profile saved.</p>
            )}
            {saveProfile.isError && (
              <p className="settings-toast is-err">
                {saveProfile.error instanceof Error
                  ? saveProfile.error.message
                  : 'Could not save profile'}
              </p>
            )}
          </div>
        </section>

        <section className="settings-panel settings-calendars">
          <div className="settings-panel-head is-plain">
            <div>
              <p className="settings-kicker">Integrations</p>
              <h2 className="settings-panel-title">Calendar accounts</h2>
              <p className="settings-meta">{connected}</p>
            </div>
          </div>

          <div className="settings-connect-row">
            <a
              className="btn btn-primary"
              href="/api/auth/google?returnTo=/settings"
            >
              Connect Google Calendar
            </a>
            <div className="settings-outlook-soon">
              <button
                type="button"
                className="btn btn-secondary"
                disabled
                aria-label="Connect Outlook Calendar — coming soon"
              >
                Connect Outlook Calendar
              </button>
              <span className="coming-soon-tag" aria-hidden>
                Coming soon
              </span>
            </div>
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending || user.connectedProviders.length === 0}
              title={
                user.connectedProviders.length === 0
                  ? 'Connect a calendar first'
                  : 'Pull latest events'
              }
            >
              {sync.isPending ? 'Syncing…' : 'Sync calendars now'}
            </button>
          </div>

          {sync.isSuccess && (
            <p className="settings-toast is-ok">
              Calendar sync completed
              {sync.data?.synced?.length
                ? `: ${sync.data.synced.join(', ')}`
                : '.'}
              {sync.data?.warning ? ` Warning: ${sync.data.warning}` : ''}
            </p>
          )}
          {sync.isError && (
            <p className="settings-toast is-err">
              {sync.error instanceof Error
                ? sync.error.message
                : 'Calendar sync failed'}
            </p>
          )}
          <p className="settings-hint">
            Connect Google, then tap Sync to import meetings into your plan.
            Stuck on “Calendar API has not been used”? Turn on Google Calendar
            API in your Cloud project and sync again.
          </p>
        </section>

        <section className="settings-panel settings-schedule-block">
          <div className="settings-panel-head is-plain">
            <div>
              <p className="settings-kicker">Hours</p>
              <h2 className="settings-panel-title">Work schedule</h2>
              <p className="page-sub">
                Pick a day, set hours and breaks, then save. Cupkey uses this
                window to place new tasks (default{' '}
                {user.defaultTaskMinutes ?? 30}m).
              </p>
            </div>
          </div>

          {scheduleQ.isLoading ? (
            <p className="settings-hint">Loading schedule…</p>
          ) : scheduleQ.isError ? (
            <p className="settings-toast is-err">
              Could not load schedule
              {scheduleQ.error instanceof Error
                ? `: ${scheduleQ.error.message}`
                : '.'}{' '}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void scheduleQ.refetch()}
              >
                Retry
              </button>
            </p>
          ) : (
            <ScheduleEditor
              byWeekday={byWeekday}
              onDaySaved={(saved) => {
                patchScheduleCache(saved);
                void qc.invalidateQueries({ queryKey: ['tasks'] });
                void qc.invalidateQueries({ queryKey: ['stats'] });
              }}
              onAllSaved={(list) => {
                qc.setQueryData(['schedule'], list);
                void qc.invalidateQueries({ queryKey: ['tasks'] });
                void qc.invalidateQueries({ queryKey: ['stats'] });
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function ScheduleEditor({
  byWeekday,
  onDaySaved,
  onAllSaved,
}: {
  byWeekday: Map<number, DailyScheduleTemplateDto>;
  onDaySaved: (saved: DailyScheduleTemplateDto) => void;
  onAllSaved: (list: DailyScheduleTemplateDto[]) => void;
}) {
  const todayWeekday = new Date().getDay() as Weekday;
  const [active, setActive] = useState<Weekday>(
    WEEKDAYS.some((d) => d.value === todayWeekday) ? todayWeekday : 1,
  );

  const template = byWeekday.get(active);

  return (
    <div className="schedule-board-ui">
      <div className="schedule-day-tabs" role="tablist" aria-label="Weekdays">
        {WEEKDAYS.map((d) => {
          const t = byWeekday.get(d.value);
          const summary = t
            ? `${toHm(t.workStart)}–${toHm(t.workEnd)}`
            : 'Not set';
          return (
            <button
              key={d.value}
              type="button"
              role="tab"
              aria-selected={active === d.value}
              className={`schedule-day-tab${active === d.value ? ' is-active' : ''}${t ? ' is-set' : ''}`}
              onClick={() => setActive(d.value)}
            >
              <strong>{d.label.slice(0, 3)}</strong>
              <span>{summary}</span>
            </button>
          );
        })}
      </div>

      <DayEditor
        key={active}
        label={WEEKDAYS.find((d) => d.value === active)?.label ?? 'Day'}
        weekday={active}
        template={template}
        onDaySaved={onDaySaved}
        onAllSaved={onAllSaved}
      />
    </div>
  );
}

function DayEditor({
  label,
  weekday,
  template,
  onDaySaved,
  onAllSaved,
}: {
  label: string;
  weekday: Weekday;
  template?: DailyScheduleTemplateDto;
  onDaySaved: (saved: DailyScheduleTemplateDto) => void;
  onAllSaved: (list: DailyScheduleTemplateDto[]) => void;
}) {
  const [workStart, setWorkStart] = useState(() =>
    toHm(template?.workStart, '09:00'),
  );
  const [workEnd, setWorkEnd] = useState(() =>
    toHm(template?.workEnd, '18:00'),
  );
  const [breaks, setBreaks] = useState<BreakDraft[]>(() =>
    (template?.breaks ?? []).map((b) => ({
      name: b.name,
      start: toHm(b.start, '12:00'),
      end: toHm(b.end, '13:00'),
    })),
  );

  const serverFp = templateFingerprint(template);
  const [hydratedFp, setHydratedFp] = useState(serverFp);

  useEffect(() => {
    if (serverFp === hydratedFp) return;
    setWorkStart(toHm(template?.workStart, '09:00'));
    setWorkEnd(toHm(template?.workEnd, '18:00'));
    setBreaks(
      (template?.breaks ?? []).map((b) => ({
        name: b.name,
        start: toHm(b.start, '12:00'),
        end: toHm(b.end, '13:00'),
      })),
    );
    setHydratedFp(serverFp);
  }, [serverFp, hydratedFp, template]);

  const localFp = `${toHm(workStart)}|${toHm(workEnd)}|${breaks
    .map((b) => `${b.name}|${toHm(b.start)}|${toHm(b.end)}`)
    .join(';')}`;
  const savedFp = template
    ? `${toHm(template.workStart)}|${toHm(template.workEnd)}|${(
        template.breaks ?? []
      )
        .map((b) => `${b.name}|${toHm(b.start)}|${toHm(b.end)}`)
        .join(';')}`
    : '';
  const dirty = localFp !== savedFp;

  const hoursValid = minutesOfHm(workEnd) > minutesOfHm(workStart);

  const buildBody = (): UpsertScheduleTemplateDto => ({
    weekday,
    workStart: toHm(workStart),
    workEnd: toHm(workEnd),
    breaks: breaks
      .filter((b) => b.name.trim() && b.start && b.end)
      .map((b) => ({
        name: b.name.trim(),
        start: toHm(b.start),
        end: toHm(b.end),
      })),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!hoursValid) {
        throw new Error('End time must be after start time');
      }
      return api.put<DailyScheduleTemplateDto>('/api/schedule', buildBody());
    },
    onSuccess: (saved) => {
      setHydratedFp(templateFingerprint(saved));
      onDaySaved(saved);
    },
  });

  const applyAll = useMutation({
    mutationFn: () => {
      if (!hoursValid) {
        throw new Error('End time must be after start time');
      }
      const body = buildBody();
      return api.put<DailyScheduleTemplateDto[]>('/api/schedule/apply-all', {
        workStart: body.workStart,
        workEnd: body.workEnd,
        breaks: body.breaks,
      });
    },
    onSuccess: (list) => {
      const mine = list.find((t) => t.weekday === weekday);
      if (mine) setHydratedFp(templateFingerprint(mine));
      onAllSaved(list);
    },
  });

  const busy = save.isPending || applyAll.isPending;

  return (
    <div className="schedule-editor">
      <header className="schedule-editor-head">
        <div>
          <h3>{label}</h3>
          <p>
            Working window{' '}
            <strong>
              {toHm(workStart)} – {toHm(workEnd)}
            </strong>
            {dirty ? <span className="schedule-dirty"> · Unsaved</span> : null}
          </p>
        </div>
        <div className="schedule-editor-actions">
          <button
            className="btn btn-outline"
            type="button"
            onClick={() => applyAll.mutate()}
            disabled={busy || !hoursValid}
            title="Copy these hours and breaks to every day"
          >
            {applyAll.isPending ? 'Applying…' : 'Apply to every day'}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => save.mutate()}
            disabled={busy || !hoursValid || !dirty}
          >
            {save.isPending ? 'Saving…' : `Save ${label}`}
          </button>
        </div>
      </header>

      <div className="schedule-editor-body">
        <div className="schedule-hours">
          <p className="settings-kicker">Work hours</p>
          <div className="settings-day-times">
            <label className="settings-field">
              <span>Start</span>
              <TimeInput
                value={workStart}
                onChange={setWorkStart}
                aria-label="Work start"
              />
            </label>
            <label className="settings-field">
              <span>End</span>
              <TimeInput
                value={workEnd}
                onChange={setWorkEnd}
                aria-label="Work end"
              />
            </label>
          </div>
          {!hoursValid && (
            <p className="settings-toast is-err" style={{ marginTop: 8 }}>
              End must be after start.
            </p>
          )}
        </div>

        <div className="schedule-breaks">
          <div className="schedule-breaks-head">
            <p className="settings-kicker">Breaks</p>
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() =>
                setBreaks([
                  ...breaks,
                  { name: 'Break', start: '12:00', end: '13:00' },
                ])
              }
            >
              + Add break
            </button>
          </div>

          {breaks.length === 0 ? (
            <p className="schedule-empty">No breaks — full focus window.</p>
          ) : (
            <div className="break-list">
              {breaks.map((b, idx) => (
                <div className="settings-break-row" key={idx}>
                  <input
                    placeholder="Break name"
                    value={b.name}
                    onChange={(e) => {
                      const next = [...breaks];
                      next[idx] = { ...b, name: e.target.value };
                      setBreaks(next);
                    }}
                  />
                  <TimeInput
                    value={b.start}
                    aria-label={`${b.name || 'Break'} start`}
                    onChange={(next) => {
                      const copy = [...breaks];
                      copy[idx] = { ...b, start: next };
                      setBreaks(copy);
                    }}
                  />
                  <TimeInput
                    value={b.end}
                    aria-label={`${b.name || 'Break'} end`}
                    onChange={(next) => {
                      const copy = [...breaks];
                      copy[idx] = { ...b, end: next };
                      setBreaks(copy);
                    }}
                  />
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() =>
                      setBreaks(breaks.filter((_, i) => i !== idx))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {(save.isError || applyAll.isError) && (
        <p className="settings-toast is-err">
          {(save.error as Error)?.message ||
            (applyAll.error as Error)?.message}
        </p>
      )}
      {(save.isSuccess || applyAll.isSuccess) && !dirty && (
        <p className="settings-toast is-ok">
          {applyAll.isSuccess
            ? 'Applied to every day. Open Schedule to see the new window.'
            : `${label} hours saved. Open Schedule to see the new window.`}
        </p>
      )}
    </div>
  );
}
