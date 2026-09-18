'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StatsOverviewDto, TaskDto, UserDto } from '@timeblock/shared-types';
import { api, formatTimeRange, parseInstant, todayISO } from '../api';

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function minutesOf(iso: string, timeZone?: string | null) {
  const d = parseInstant(iso);
  const tz =
    timeZone?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    return Number(map.hour) * 60 + Number(map.minute);
  } catch {
    return d.getHours() * 60 + d.getMinutes();
  }
}

function nowMinutes(timeZone?: string | null) {
  return minutesOf(new Date().toISOString(), timeZone);
}

/** Pick the task that is live / in the current slot / next up. */
function resolveCurrentTask(
  tasks: TaskDto[],
  timeZone?: string | null,
): { task: TaskDto | null; mode: 'live' | 'now' | 'next' | 'idle' } {
  const list = tasks.filter((t) => !t.inBacklog);
  const running = list.find((t) => t.activeEntryId);
  if (running) return { task: running, mode: 'live' };

  const now = nowMinutes(timeZone);
  const inSlot = list
    .filter(
      (t) =>
        t.status !== 'completed' &&
        t.scheduledStart &&
        t.scheduledEnd &&
        minutesOf(t.scheduledStart, timeZone) <= now &&
        now < minutesOf(t.scheduledEnd, timeZone),
    )
    .sort(
      (a, b) =>
        minutesOf(a.scheduledStart!, timeZone) -
        minutesOf(b.scheduledStart!, timeZone),
    )[0];
  if (inSlot) return { task: inSlot, mode: 'now' };

  const upcoming = list
    .filter(
      (t) =>
        t.status !== 'completed' &&
        t.scheduledStart &&
        minutesOf(t.scheduledStart, timeZone) > now,
    )
    .sort(
      (a, b) =>
        minutesOf(a.scheduledStart!, timeZone) -
        minutesOf(b.scheduledStart!, timeZone),
    )[0];
  if (upcoming) return { task: upcoming, mode: 'next' };

  return { task: null, mode: 'idle' };
}

export function RightPanel({ user }: { user: UserDto }) {
  const date = todayISO(user.timezone);
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const stats = useQuery({
    queryKey: ['stats', date],
    queryFn: () =>
      api.get<StatsOverviewDto>(`/api/stats/overview?date=${date}`),
  });
  const tasks = useQuery({
    queryKey: ['tasks', date],
    queryFn: () => api.get<TaskDto[]>(`/api/tasks?date=${date}`),
  });

  const util = stats.data?.utilization;
  const pct = util?.utilizationPercent ?? 0;
  const cal = useMemo(
    () => buildMiniCalendar(new Date(`${date}T12:00:00`)),
    [date],
  );
  const current = useMemo(
    () => resolveCurrentTask(tasks.data ?? [], user.timezone),
    [tasks.data, user.timezone, tick],
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['tasks', date] });
    void qc.invalidateQueries({ queryKey: ['stats', date] });
    void qc.invalidateQueries({ queryKey: ['eod', date] });
  };

  return (
    <aside className="right-panel">
      <div className="panel-tools">
        <button className="icon-btn" type="button" aria-label="Notifications">
          ●
        </button>
        <div className="avatar sm">{initials(user.name)}</div>
      </div>

      <CurrentTaskCard
        task={current.task}
        mode={current.mode}
        timeZone={user.timezone}
        onChanged={invalidate}
      />

      <div className="panel-card">
        <h3>Day utilization</h3>
        <div className="util-ring" style={{ ['--pct' as string]: pct }}>
          <div className="util-ring-inner">{pct}%</div>
        </div>
        <div className="task-meta" style={{ textAlign: 'center' }}>
          {util
            ? `${util.scheduledMinutes} / ${util.availableMinutes} min scheduled`
            : '—'}
        </div>
        {util?.tip ? (
          <div className="tip">{util.tip}</div>
        ) : (
          <div className="tip">
            Don&apos;t go over 80% utilization — leave room for ad-hoc tasks.
          </div>
        )}
      </div>

      <div className="panel-card">
        <h3>Today</h3>
        <Counters
          total={stats.data?.today.total ?? 0}
          completed={stats.data?.today.completed ?? 0}
          pending={stats.data?.today.pending ?? 0}
        />
      </div>

      <div className="panel-card">
        <h3>This week</h3>
        <Counters
          total={stats.data?.week.total ?? 0}
          completed={stats.data?.week.completed ?? 0}
          pending={stats.data?.week.pending ?? 0}
        />
      </div>

      <div className="panel-card mini-cal">
        <div className="mini-cal-head">
          <span>{cal.monthLabel}</span>
        </div>
        <div className="mini-cal-grid">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div className="dow" key={`${d}-${i}`}>
              {d}
            </div>
          ))}
          {cal.days.map((d, i) => (
            <button
              key={i}
              type="button"
              className={`day ${d.today ? 'today' : ''} ${d.muted ? 'muted' : ''}`}
            >
              {d.n}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function CurrentTaskCard({
  task,
  mode,
  timeZone,
  onChanged,
}: {
  task: TaskDto | null;
  mode: 'live' | 'now' | 'next' | 'idle';
  timeZone?: string | null;
  onChanged: () => void;
}) {
  const running = Boolean(task?.activeEntryId);
  const done = task?.status === 'completed';

  const start = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/timer/${task!.id}/start`),
    onSuccess: () => onChanged(),
  });
  const stop = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/timer/${task!.id}/stop`),
    onSuccess: () => onChanged(),
  });
  const complete = useMutation({
    mutationFn: () => api.patch<TaskDto>(`/api/tasks/${task!.id}/complete`),
    onSuccess: () => onChanged(),
  });

  const busy = start.isPending || stop.isPending || complete.isPending;
  const label =
    mode === 'live'
      ? 'In progress'
      : mode === 'now'
        ? 'Now'
        : mode === 'next'
          ? 'Up next'
          : 'Now';

  return (
    <div className={`panel-card now-card${mode === 'live' ? ' is-live' : ''}`}>
      <div className="now-card-head">
        <h3>Current task</h3>
        {task && <span className={`now-status is-${mode}`}>{label}</span>}
      </div>

      {!task ? (
        <p className="now-empty">No task in this slot.</p>
      ) : (
        <>
          <div className="now-title">{task.name}</div>
          <div className="now-meta">
            {formatTimeRange(task.scheduledStart, task.scheduledEnd, timeZone)}
            {!task.scheduleLocked ? ` · ${task.estimatedMinutes}m` : ''}
          </div>
          {!done && (
            <div className="now-actions">
              {running ? (
                <button
                  type="button"
                  className="btn btn-primary btn-pill btn-sm"
                  disabled={busy}
                  onClick={() => stop.mutate()}
                >
                  {stop.isPending ? 'Stopping…' : 'Stop'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline btn-pill btn-sm"
                  disabled={busy}
                  onClick={() => start.mutate()}
                >
                  {start.isPending ? 'Starting…' : 'Start'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-soft btn-pill btn-sm"
                disabled={busy}
                onClick={() => complete.mutate()}
              >
                {complete.isPending ? 'Saving…' : 'Done'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Counters({
  total,
  completed,
  pending,
}: {
  total: number;
  completed: number;
  pending: number;
}) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Row label="Total tasks" value={total} />
      <Row label="Completed" value={completed} />
      <Row label="Pending" value={pending} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        color: 'var(--text-muted)',
      }}
    >
      <span>{label}</span>
      <strong style={{ color: 'var(--text)' }}>{value}</strong>
    </div>
  );
}

function buildMiniCalendar(anchor: Date) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const monthLabel = anchor.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = anchor.getDate();
  const days: Array<{ n: number; muted: boolean; today: boolean }> = [];
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = startPad - 1; i >= 0; i--) {
    days.push({ n: prevDays - i, muted: true, today: false });
  }
  for (let n = 1; n <= daysInMonth; n++) {
    days.push({ n, muted: false, today: n === today });
  }
  let next = 1;
  while (days.length % 7 !== 0) {
    days.push({ n: next++, muted: true, today: false });
  }
  return { monthLabel, days };
}
