'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DailyScheduleTemplateDto,
  UpsertScheduleTemplateDto,
  UserDto,
  Weekday,
} from '@timeblock/shared-types';
import { api, detectBrowserTimeZone } from '../api';
import { DemoVideoCard } from '../components/ui-hints';
import {
  fileToAvatar,
  onAvatarChange,
  readAvatar,
  writeAvatar,
} from '../components/user-avatar';

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

/** Normalize any time string to HH:mm. */
function toHm(value: string | null | undefined, fallback = '09:00'): string {
  const raw = (value ?? '').trim();
  if (!raw) return fallback;

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 3 || digits.length === 4) {
    const padded = digits.padStart(4, '0');
    const h = Math.min(23, Number(padded.slice(0, 2)));
    const m = Math.min(59, Number(padded.slice(2, 4)));
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

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
  const hm = toHm(value);
  const [draft, setDraft] = useState(hm);

  useEffect(() => {
    setDraft(hm);
  }, [hm]);

  const commit = (raw: string) => {
    const next = toHm(raw, hm);
    setDraft(next);
    if (next !== hm) onChange(next);
  };

  return (
    <input
      type="text"
      className="settings-time-input"
      value={draft}
      inputMode="numeric"
      placeholder="09:00"
      maxLength={5}
      spellCheck={false}
      autoComplete="off"
      aria-label={ariaLabel}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
        let next = digits;
        if (digits.length > 2) {
          next = `${digits.slice(0, 2)}:${digits.slice(2)}`;
        }
        setDraft(next);
        if (/^\d{2}:\d{2}$/.test(next)) onChange(toHm(next));
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(draft);
          (e.target as HTMLInputElement).blur();
        }
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
  const router = useRouter();
  const search = useSearchParams();
  const panelRaw = search.get('panel');
  const panel: 'profile' | 'account' | 'help' =
    panelRaw === 'account' || panelRaw === 'help' ? panelRaw : 'profile';
  const photoInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [timezone, setTimezone] = useState(
    user.timezone || detectBrowserTimeZone(),
  );
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [defaultTaskMinutes, setDefaultTaskMinutes] = useState(
    String(user.defaultTaskMinutes ?? 30),
  );

  useEffect(() => {
    setPhoto(readAvatar(user.id));
    return onAvatarChange(() => setPhoto(readAvatar(user.id)));
  }, [user.id]);

  useEffect(() => {
    setName(user.name);
    setEmail(user.email);
    setTimezone(user.timezone || detectBrowserTimeZone());
    setDefaultTaskMinutes(String(user.defaultTaskMinutes ?? 30));
  }, [user.id, user.name, user.email, user.timezone, user.defaultTaskMinutes]);

  const scheduleQ = useQuery({
    queryKey: ['schedule'],
    queryFn: async () => {
      const rows = await api.get<DailyScheduleTemplateDto[]>('/api/schedule');
      return Array.isArray(rows) ? rows : [];
    },
    retry: 2,
  });

  const saveProfile = useMutation({
    mutationFn: (patch: {
      name?: string;
      email?: string;
      timezone?: string;
      defaultTaskMinutes?: number;
    }) => api.patch<UserDto>('/api/users/me', patch),
    onSuccess: (next) => {
      qc.setQueryData(['me'], next);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const changePassword = useMutation({
    mutationFn: () =>
      api.post<{ ok: true }>('/api/users/me/password', {
        currentPassword,
        newPassword,
      }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
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

  const openPanel = (next: 'profile' | 'account' | 'help') => {
    router.replace(next === 'profile' ? '/settings' : `/settings?panel=${next}`);
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user.name) return;
    saveProfile.mutate({ name: trimmed });
  };

  const saveEmail = () => {
    const trimmed = email.trim();
    if (!trimmed || trimmed === user.email) return;
    saveProfile.mutate({ email: trimmed });
  };

  const saveTimezone = (next: string) => {
    setTimezone(next);
    if (next && next !== user.timezone) saveProfile.mutate({ timezone: next });
  };

  const saveDefaultMinutes = () => {
    const minutes = Math.max(5, Math.min(240, Number(defaultTaskMinutes) || 30));
    if (minutes === user.defaultTaskMinutes) return;
    saveProfile.mutate({ defaultTaskMinutes: minutes });
  };

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    try {
      const dataUrl = await fileToAvatar(file);
      writeAvatar(user.id, dataUrl);
      setPhoto(dataUrl);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not use that photo');
    }
  };

  return (
    <div className="settings-page settings-kit">
      <header className="settings-hero">
        <div>
          <p className="settings-kicker">Cupkey</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">
            Profile, account, and help. Changes save as you type.
          </p>
        </div>
      </header>

      <div className="settings-kit-layout">
        <nav className="settings-kit-nav" aria-label="Settings sections">
          <button
            type="button"
            className={panel === 'profile' ? 'is-active' : ''}
            onClick={() => openPanel('profile')}
          >
            Profile
          </button>
          <button
            type="button"
            className={panel === 'account' ? 'is-active' : ''}
            onClick={() => openPanel('account')}
          >
            Account
          </button>
          <button
            type="button"
            className={panel === 'help' ? 'is-active' : ''}
            onClick={() => openPanel('help')}
          >
            Help
          </button>
        </nav>

        <div className="settings-kit-main">
          {panel === 'profile' && (
            <>
              <section className="settings-panel">
                <div className="settings-panel-head">
                  <button
                    type="button"
                    className="settings-avatar settings-avatar-btn"
                    onClick={() => photoInput.current?.click()}
                    aria-label="Change profile photo"
                  >
                    {photo ? (
                      <img src={photo} alt="" />
                    ) : (
                      initials(name || user.name)
                    )}
                  </button>
                  <div>
                    <p className="settings-kicker">Profile</p>
                    <h2 className="settings-panel-title">
                      {name.trim() || user.name || 'Your profile'}
                    </h2>
                    <p className="settings-meta">
                      Photo, timezone, and the hours Cupkey plans into.
                    </p>
                  </div>
                </div>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    void onPickPhoto(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <div className="settings-photo-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => photoInput.current?.click()}
                  >
                    Upload photo
                  </button>
                  {photo ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        writeAvatar(user.id, null);
                        setPhoto(null);
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                {photoError ? (
                  <p className="settings-toast is-err">{photoError}</p>
                ) : null}

                <div className="settings-fields">
                  <label className="settings-field">
                    <span>Name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={saveName}
                      placeholder="Name"
                    />
                  </label>
                  <label className="settings-field">
                    <span>Timezone</span>
                    <select
                      value={timezone}
                      onChange={(e) => saveTimezone(e.target.value)}
                      aria-label="Timezone"
                    >
                      {timezoneOptions(timezone).map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
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
                        onBlur={saveDefaultMinutes}
                        aria-label="Default task duration in minutes"
                      />
                      <em>min</em>
                    </div>
                  </label>
                </div>
                <p className="settings-hint">
                  Timezone follows your laptop (
                  {detectBrowserTimeZone()}
                  ). Change it here if you plan in another zone.
                </p>
                {saveProfile.isError && (
                  <p className="settings-toast is-err">
                    {saveProfile.error instanceof Error
                      ? saveProfile.error.message
                      : 'Could not save profile'}
                  </p>
                )}
              </section>

              <section className="settings-panel settings-schedule-block">
                <div className="settings-panel-head is-plain">
                  <div>
                    <p className="settings-kicker">Schedule</p>
                    <h2 className="settings-panel-title">Your week</h2>
                    <p className="page-sub">
                      One column of days. Edit a day, or copy it to every weekday.
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
                      qc.setQueryData<DailyScheduleTemplateDto[]>(
                        ['schedule'],
                        (old) => {
                          const map = new Map<number, DailyScheduleTemplateDto>();
                          for (const row of old ?? []) map.set(row.weekday, row);
                          for (const row of list) map.set(row.weekday, row);
                          return [...map.values()].sort(
                            (a, b) => a.weekday - b.weekday,
                          );
                        },
                      );
                      void qc.invalidateQueries({ queryKey: ['tasks'] });
                      void qc.invalidateQueries({ queryKey: ['stats'] });
                    }}
                  />
                )}
              </section>
            </>
          )}

          {panel === 'account' && (
            <>
              <section className="settings-panel">
                <div className="settings-panel-head is-plain">
                  <div>
                    <p className="settings-kicker">Account</p>
                    <h2 className="settings-panel-title">Email</h2>
                    <p className="settings-meta">Used to sign in and to find your account.</p>
                  </div>
                </div>
                <div className="settings-fields">
                  <label className="settings-field">
                    <span>Email</span>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={saveEmail}
                      placeholder="Email"
                      type="email"
                    />
                  </label>
                </div>
              </section>

              <section className="settings-panel">
                <div className="settings-panel-head is-plain">
                  <div>
                    <p className="settings-kicker">Account</p>
                    <h2 className="settings-panel-title">Password</h2>
                    <p className="settings-meta">
                      Leave current blank if you signed in with Google and have not set one yet.
                    </p>
                  </div>
                </div>
                <div className="settings-fields">
                  <label className="settings-field">
                    <span>Current password</span>
                    <input
                      type="password"
                      value={currentPassword}
                      autoComplete="current-password"
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </label>
                  <label className="settings-field">
                    <span>New password</span>
                    <input
                      type="password"
                      value={newPassword}
                      autoComplete="new-password"
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </label>
                </div>
                <div className="settings-panel-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={changePassword.isPending || newPassword.trim().length < 8}
                    onClick={() => changePassword.mutate()}
                  >
                    {changePassword.isPending ? 'Updating…' : 'Update password'}
                  </button>
                  {changePassword.isSuccess && (
                    <p className="settings-toast is-ok">Password updated.</p>
                  )}
                  {changePassword.isError && (
                    <p className="settings-toast is-err">
                      {changePassword.error instanceof Error
                        ? changePassword.error.message
                        : 'Could not update password'}
                    </p>
                  )}
                </div>
              </section>

              <section className="settings-panel settings-calendars">
                <div className="settings-panel-head is-plain">
                  <div>
                    <p className="settings-kicker">Account</p>
                    <h2 className="settings-panel-title">Calendar</h2>
                    <p className="settings-meta">{connected}</p>
                  </div>
                </div>
                <div className="settings-connect-row">
                  <a
                    className="btn btn-primary"
                    href={`/api/auth/google?returnTo=${encodeURIComponent('/settings?panel=account')}`}
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
                  Connect links the account. Sync pulls the latest meetings into your plan.
                </p>
              </section>
            </>
          )}

          {panel === 'help' && (
            <section className="settings-panel">
              <div className="settings-panel-head is-plain">
                <div>
                  <p className="settings-kicker">Help</p>
                  <h2 className="settings-panel-title">Talk to Cupkey</h2>
                  <p className="settings-meta">
                    Questions about your plan, calendar, or timesheet.
                  </p>
                </div>
              </div>
              <a className="btn btn-primary settings-help-mail" href="mailto:hello@cupkey.io">
                hello@cupkey.io
              </a>
              <DemoVideoCard />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function timezoneOptions(current: string) {
  const base = [
    detectBrowserTimeZone(),
    current,
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Riyadh',
    'Asia/Singapore',
    'Europe/London',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
    'UTC',
  ];
  return [...new Set(base.filter(Boolean))];
}

function workableMinutes(t: DailyScheduleTemplateDto) {
  let mins = minutesOfHm(toHm(t.workEnd)) - minutesOfHm(toHm(t.workStart));
  for (const b of t.breaks ?? []) {
    const span = minutesOfHm(toHm(b.end)) - minutesOfHm(toHm(b.start));
    if (span > 0) mins -= span;
  }
  return Math.max(0, mins);
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function breakSummary(t: DailyScheduleTemplateDto) {
  const rows = t.breaks ?? [];
  if (!rows.length) return 'No breaks';
  return rows
    .map((b) => `${b.name} ${toHm(b.start)}`)
    .slice(0, 2)
    .join(' · ');
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
  const weekMinutes = WEEKDAYS.reduce((sum, d) => {
    const t = byWeekday.get(d.value);
    return t ? sum + workableMinutes(t) : sum;
  }, 0);

  return (
    <div className="week-board">
      <div className="week-column">
        <div className="week-day-list" role="tablist" aria-label="Your week">
          {WEEKDAYS.map((d) => {
            const t = byWeekday.get(d.value);
            const off = !t;
            return (
              <button
                key={d.value}
                type="button"
                role="tab"
                aria-selected={active === d.value}
                className={`week-day-row${active === d.value ? ' is-active' : ''}${off ? ' is-off' : ''}`}
                onClick={() => setActive(d.value)}
              >
                <span className="week-day-name">{d.label.slice(0, 3)}</span>
                {off ? (
                  <span className="week-day-off">Off — and it stays off</span>
                ) : (
                  <>
                    <span className="week-day-hours">
                      {toHm(t.workStart)} – {toHm(t.workEnd)}
                    </span>
                    <span className="week-day-breaks">{breakSummary(t)}</span>
                    <span className="week-day-total">
                      {active === d.value
                        ? 'Editing'
                        : formatDuration(workableMinutes(t))}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div className="week-totals">
          <div>
            <span>Workable this week</span>
            <strong>{formatDuration(weekMinutes)}</strong>
          </div>
          <div>
            <span>Target at 80% cap</span>
            <strong className="is-accent">
              {formatDuration(Math.round(weekMinutes * 0.8))}
            </strong>
          </div>
        </div>
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
    mutationFn: async () => {
      if (!hoursValid) {
        throw new Error('End time must be after start time');
      }
      const body = buildBody();
      const weekdays: Weekday[] = [1, 2, 3, 4, 5];
      const saved: DailyScheduleTemplateDto[] = [];
      for (const day of weekdays) {
        saved.push(
          await api.put<DailyScheduleTemplateDto>('/api/schedule', {
            ...body,
            weekday: day,
          }),
        );
      }
      return saved;
    },
    onSuccess: (list) => {
      const mine = list.find((t) => t.weekday === weekday);
      if (mine) setHydratedFp(templateFingerprint(mine));
      onAllSaved(list);
    },
  });

  const busy = save.isPending || applyAll.isPending;
  const lastAttempt = useRef('');
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;
  const initialFp = useRef(localFp);
  const edited = localFp !== initialFp.current;

  useEffect(() => {
    if (!edited || !dirty || !hoursValid || busy) return;
    if (lastAttempt.current === localFp) return;
    const timer = window.setTimeout(() => {
      lastAttempt.current = localFp;
      saveRef.current();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [edited, dirty, hoursValid, busy, localFp]);

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
            {edited ? (
              dirty ? (
                <span className="schedule-dirty"> · Saving…</span>
              ) : (
                <span className="schedule-dirty"> · Saved</span>
              )
            ) : template ? (
              <span className="schedule-dirty"> · Saved</span>
            ) : null}
          </p>
        </div>
        <div className="schedule-editor-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => applyAll.mutate()}
            disabled={busy || !hoursValid}
            title="Copy these hours and breaks onto Monday through Friday"
          >
            {applyAll.isPending ? 'Applying…' : 'Apply to every weekday'}
          </button>
        </div>
      </header>

      <div className="schedule-editor-body">
        <div className="schedule-hours">
          <p className="settings-kicker">Work hours</p>
          <div className="settings-day-times">
            <label className="settings-field">
              <span>Work starts</span>
              <TimeInput
                value={workStart}
                onChange={setWorkStart}
                aria-label="Work start"
              />
            </label>
            <label className="settings-field">
              <span>Work ends</span>
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
                    className="break-name"
                    placeholder="Name"
                    aria-label="Break name"
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
                    className="break-remove"
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
      {applyAll.isSuccess && !dirty && (
        <p className="settings-toast is-ok">
          Applied to every weekday. Weekends stay as they are.
        </p>
      )}
    </div>
  );
}
