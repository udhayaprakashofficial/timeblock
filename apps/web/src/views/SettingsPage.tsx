'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DailyScheduleTemplateDto,
  UpsertScheduleTemplateDto,
  UserDto,
  Weekday,
} from '@timeblock/shared-types';
import { api } from '../api';

const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

export function SettingsPage({ user }: { user: UserDto }) {
  const qc = useQueryClient();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [defaultTaskMinutes, setDefaultTaskMinutes] = useState(
    String(user.defaultTaskMinutes ?? 30),
  );

  const scheduleQ = useQuery({
    queryKey: ['schedule'],
    queryFn: () => api.get<DailyScheduleTemplateDto[]>('/api/schedule'),
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      api.patch<UserDto>('/api/users/me', {
        name,
        email,
        defaultTaskMinutes: Number(defaultTaskMinutes),
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

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">
        Your profile, calendars, and daily schedule are stored in the database
        under your user account.
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>User profile (saved in DB)</h3>
        <p className="task-meta">User id: {user.id}</p>
        <p className="task-meta" style={{ marginTop: 8 }}>
          Timezone (from your location): {user.timezone || 'UTC'}
        </p>
        <div className="form-row" style={{ marginTop: 12 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />
          <label className="task-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Default task
            <input
              type="number"
              min={5}
              step={5}
              value={defaultTaskMinutes}
              onChange={(e) => setDefaultTaskMinutes(e.target.value)}
              style={{ width: 72 }}
              aria-label="Default task duration in minutes"
            />
            min
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={saveProfile.isPending}
            onClick={() => saveProfile.mutate()}
          >
            Save profile
          </button>
        </div>
        {saveProfile.isSuccess && (
          <p className="task-meta">Profile saved to database.</p>
        )}
        {saveProfile.isError && (
          <p className="task-meta" style={{ color: 'var(--coral)' }}>
            {saveProfile.error instanceof Error
              ? saveProfile.error.message
              : 'Could not save profile'}
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Calendar accounts</h3>
        <p className="task-meta">
          Connected:{' '}
          {user.connectedProviders.length
            ? user.connectedProviders.join(', ')
            : 'none'}
        </p>
        <div className="form-row" style={{ marginTop: 12 }}>
          <a
            className="btn btn-primary"
            href="/api/auth/google?returnTo=/settings"
          >
            Connect Google Calendar
          </a>
          <a
            className="btn btn-secondary"
            href="/api/auth/microsoft?returnTo=/settings"
          >
            Connect Outlook Calendar
          </a>
          <button
            className="btn btn-outline"
            type="button"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? 'Syncing…' : 'Sync calendars now'}
          </button>
        </div>
        {sync.isSuccess && (
          <p className="task-meta">
            Calendar sync completed
            {sync.data?.synced?.length
              ? `: ${sync.data.synced.join(', ')}`
              : '.'}
            {sync.data?.warning ? ` Warning: ${sync.data.warning}` : ''}
          </p>
        )}
        {sync.isError && (
          <p className="task-meta" style={{ color: 'var(--coral)', maxWidth: 640 }}>
            {sync.error instanceof Error
              ? sync.error.message
              : 'Calendar sync failed'}
          </p>
        )}
        <p className="task-meta" style={{ marginTop: 10 }}>
          If sync fails with “Calendar API has not been used”, enable Google
          Calendar API for your Cloud project, then click Sync again.
        </p>
      </div>

      <h3>Work schedule</h3>
      <p className="page-sub">
        Set work start and closing times plus breaks. New tasks auto-fill the
        next free slot inside these hours (default {user.defaultTaskMinutes ?? 30}
        m). Save a day, or apply one profile to every weekday.
      </p>
      <div className="settings-grid">
        {WEEKDAYS.map((d) => (
          <DayEditor
            key={`${d.value}-${byWeekday.get(d.value)?.id ?? 'new'}`}
            label={d.label}
            weekday={d.value}
            template={byWeekday.get(d.value)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ['schedule'] });
              qc.invalidateQueries({ queryKey: ['tasks'] });
              qc.invalidateQueries({ queryKey: ['stats'] });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function DayEditor({
  label,
  weekday,
  template,
  onSaved,
}: {
  label: string;
  weekday: Weekday;
  template?: DailyScheduleTemplateDto;
  onSaved: () => void;
}) {
  const [workStart, setWorkStart] = useState(template?.workStart ?? '09:00');
  const [workEnd, setWorkEnd] = useState(template?.workEnd ?? '18:00');
  const [breaks, setBreaks] = useState(
    template?.breaks.map((b) => ({
      name: b.name,
      start: b.start,
      end: b.end,
    })) ?? [],
  );

  const save = useMutation({
    mutationFn: () => {
      if (!workStart || !workEnd) {
        throw new Error('Set work start and end times before saving');
      }
      const body: UpsertScheduleTemplateDto = {
        weekday,
        workStart,
        workEnd,
        breaks: breaks.filter((b) => b.name && b.start && b.end),
      };
      return api.put('/api/schedule', body);
    },
    onSuccess: onSaved,
  });

  const applyAll = useMutation({
    mutationFn: () => {
      if (!workStart || !workEnd) {
        throw new Error('Set work start and end times before applying');
      }
      return api.put('/api/schedule/apply-all', {
        workStart,
        workEnd,
        breaks: breaks.filter((b) => b.name && b.start && b.end),
      });
    },
    onSuccess: onSaved,
  });

  return (
    <div className="card settings-day">
      <h4>{label}</h4>
      <div className="form-row">
        <label>
          Work start
          <input
            type="time"
            value={workStart}
            onChange={(e) => setWorkStart(e.target.value)}
          />
        </label>
        <label>
          Work end
          <input
            type="time"
            value={workEnd}
            onChange={(e) => setWorkEnd(e.target.value)}
          />
        </label>
      </div>
      <div className="break-list">
        {breaks.map((b, idx) => (
          <div className="form-row" key={idx}>
            <input
              placeholder="Break name"
              value={b.name}
              onChange={(e) => {
                const next = [...breaks];
                next[idx] = { ...b, name: e.target.value };
                setBreaks(next);
              }}
            />
            <input
              type="time"
              value={b.start}
              onChange={(e) => {
                const next = [...breaks];
                next[idx] = { ...b, start: e.target.value };
                setBreaks(next);
              }}
            />
            <input
              type="time"
              value={b.end}
              onChange={(e) => {
                const next = [...breaks];
                next[idx] = { ...b, end: e.target.value };
                setBreaks(next);
              }}
            />
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setBreaks(breaks.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className="btn btn-outline"
          type="button"
          onClick={() =>
            setBreaks([...breaks, { name: '', start: '', end: '' }])
          }
        >
          Add break
        </button>
      </div>
      <div className="form-row" style={{ marginTop: 12 }}>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || applyAll.isPending || !workStart || !workEnd}
        >
          Save {label}
        </button>
        <button
          className="btn btn-outline"
          type="button"
          onClick={() => applyAll.mutate()}
          disabled={save.isPending || applyAll.isPending || !workStart || !workEnd}
          title="Copy these hours and breaks to every day"
        >
          Apply to every day
        </button>
      </div>
      {(save.isError || applyAll.isError) && (
        <p className="task-meta">
          {(save.error as Error)?.message ||
            (applyAll.error as Error)?.message}
        </p>
      )}
    </div>
  );
}
