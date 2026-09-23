'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StatsOverviewDto, TaskDto, UserDto } from '@timeblock/shared-types';
import { api, formatTimeRange, parseInstant, todayISO } from '../api';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  completeTaskOptimistic,
  fetchTasks,
  startTimerOptimistic,
  tasksActions,
} from '../store/tasksSlice';
import { fetchStats } from '../store/statsSlice';
import { HintMark } from './ui-hints';
import { CoachSlot, resolveCoachSlot } from './coach';
import { ShareStudio } from './share/ShareStudio';
import type { ShareWeekPayload } from './share/shareFormat';
import {
  formatWeekSpan,
  isoWeekNumber,
  weekdayShort,
} from './share/shareFormat';
import type { WeeklyReportDto } from '@timeblock/shared-types';

const EMPTY_PANEL_TASKS: TaskDto[] = [];

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
  const dispatch = useAppDispatch();
  const [tick, setTick] = useState(0);
  const [mutedUntil, setMutedUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const MUTE_KEY = 'tb.coachMuteUntil';

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MUTE_KEY);
      const until = raw ? Number(raw) : NaN;
      if (Number.isFinite(until) && until > Date.now()) setMutedUntil(until);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void dispatch(fetchTasks(date));
  }, [dispatch, date]);

  const stats = useQuery({
    queryKey: ['stats', date],
    queryFn: () =>
      api.get<StatsOverviewDto>(`/api/stats/overview?date=${date}`),
  });

  const weekly = useQuery({
    queryKey: ['weekly', date],
    queryFn: () => api.get<WeeklyReportDto>(`/api/stats/weekly?date=${date}`),
  });

  const taskList = useAppSelector((s) => s.tasks.byDate[date] ?? EMPTY_PANEL_TASKS);

  const util = stats.data?.utilization;
  const available = Math.max(1, util?.availableMinutes ?? 480);
  const scheduledFromApi = util?.scheduledMinutes ?? 0;

  // Real tracked / planned minutes — never invent category spend
  const isMeet = (t: TaskDto) => Boolean(t.scheduleLocked || t.meetLink);
  const spent = (t: TaskDto) => {
    if (t.actualMinutes > 0) return t.actualMinutes;
    // Completed without a timer still credits estimate (proof of work)
    if (t.status === 'completed') return Math.max(0, t.estimatedMinutes || 0);
    return 0;
  };
  const planned = (t: TaskDto) =>
    t.status === 'completed' ? 0 : Math.max(0, t.estimatedMinutes || 0);

  const deepLogged = taskList
    .filter((t) => !isMeet(t))
    .reduce((s, t) => s + spent(t), 0);
  const meetLogged = taskList
    .filter((t) => isMeet(t))
    .reduce((s, t) => s + spent(t), 0);
  const deepPlanned = taskList
    .filter((t) => !isMeet(t))
    .reduce((s, t) => s + planned(t), 0);
  const meetPlanned = taskList
    .filter((t) => isMeet(t))
    .reduce((s, t) => s + planned(t), 0);

  // Load = scheduled work vs available day (API when present)
  const scheduledTotal = Math.max(
    scheduledFromApi,
    deepLogged + meetLogged + deepPlanned + meetPlanned,
  );
  const loadPct = Math.min(
    100,
    Math.round(
      (util?.utilizationPercent ?? (scheduledTotal / available) * 100),
    ),
  );

  // Focus: reward healthy utilization (~50–70%), not fake filler
  const focusScore = Math.max(
    0,
    Math.min(100, Math.round(100 - Math.abs(loadPct - 55) * 1.2)),
  );

  // Bar segments: logged deep / logged meet / still planned / open capacity
  const openMins = Math.max(
    0,
    available - deepLogged - meetLogged - deepPlanned - meetPlanned,
  );
  const sliceTotal = Math.max(
    1,
    deepLogged + meetLogged + deepPlanned + meetPlanned + openMins,
  );
  const deepPct = Math.round((deepLogged / sliceTotal) * 100);
  const meetPct = Math.round((meetLogged / sliceTotal) * 100);
  const plannedPct = Math.round(
    ((deepPlanned + meetPlanned) / sliceTotal) * 100,
  );
  const openPct = Math.max(0, 100 - deepPct - meetPct - plannedPct);

  const current = useMemo(
    () => resolveCurrentTask(taskList, user.timezone),
    [taskList, user.timezone, tick],
  );

  const weekDays = useMemo(() => {
    const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const todayIdx = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
    const todayLoad = Math.min(100, loadPct);
    return labels.map((label, i) => {
      const isToday = i === todayIdx;
      // Only today is real; other days stay neutral until weekly API is wired
      const height = isToday ? Math.max(8, todayLoad) : 12;
      return { label, height, isToday };
    });
  }, [date, loadPct]);

  const liveRemainingMins = useMemo(() => {
    if (current.mode !== 'live' || !current.task?.scheduledEnd) return null;
    const end = parseInstant(current.task.scheduledEnd).getTime();
    const left = Math.ceil((end - Date.now()) / 60_000);
    return left > 0 ? left : null;
  }, [current, tick]);

  const muteMins = liveRemainingMins
    ? Math.max(10, Math.min(90, liveRemainingMins))
    : Math.max(15, Math.min(45, 90 - Math.round(loadPct / 2)));

  const openTasks = taskList.filter((t) => t.status !== 'completed').length;
  const doneTasks = taskList.filter((t) => t.status === 'completed').length;

  const weekActualMinutes = weekly.data?.totals.actualMinutes ?? 0;
  const weekNo = weekly.data
    ? isoWeekNumber(weekly.data.weekStart)
    : isoWeekNumber(date);

  const shareWeek: ShareWeekPayload | null = useMemo(() => {
    const data = weekly.data;
    if (!data) return null;
    const est = data.totals.estimatedMinutes;
    const act = data.totals.actualMinutes;
    const drift = act - est;
    const acc =
      est <= 0
        ? 100
        : Math.max(0, Math.min(100, Math.round((1 - Math.abs(drift) / est) * 100)));
    return {
      weekStart: data.weekStart,
      weekEnd: data.weekEnd,
      weekLabel: `Week ${isoWeekNumber(data.weekStart)} · ${formatWeekSpan(data.weekStart, data.weekEnd)}`,
      estimatedMinutes: est,
      actualMinutes: act,
      driftMinutes: drift,
      completed: data.totals.completed,
      total: data.totals.total,
      completionPercent:
        data.totals.total > 0
          ? Math.round((data.totals.completed / data.totals.total) * 100)
          : 0,
      accuracyPercent: acc,
      days: data.byDay.map((d) => ({
        date: d.date,
        label: weekdayShort(d.date),
        estimatedMinutes: d.estimatedMinutes,
        actualMinutes: d.actualMinutes,
      })),
    };
  }, [weekly.data]);

  const coachContent = useMemo(
    () =>
      resolveCoachSlot({
        date,
        loadPct,
        focusScore,
        deepLogged,
        meetLogged,
        openTasks,
        doneTasks,
        liveRemainingMins,
        current: {
          mode: current.mode,
          taskName: current.task?.name ?? null,
        },
        mutedUntil,
        muteMins,
        weekActualMinutes,
        weekNumber: weekNo,
      }),
    [
      date,
      loadPct,
      focusScore,
      deepLogged,
      meetLogged,
      openTasks,
      doneTasks,
      liveRemainingMins,
      current,
      mutedUntil,
      muteMins,
      weekActualMinutes,
      weekNo,
      tick,
    ],
  );

  const applyMute = (minutes: number) => {
    const until = Date.now() + minutes * 60_000;
    setMutedUntil(until);
    try {
      sessionStorage.setItem(MUTE_KEY, String(until));
    } catch {
      /* ignore */
    }
  };

  const clearMute = () => {
    setMutedUntil(null);
    try {
      sessionStorage.removeItem(MUTE_KEY);
    } catch {
      /* ignore */
    }
  };

  const afterMutation = () => {
    void qc.invalidateQueries({ queryKey: ['stats', date] });
    void dispatch(fetchStats(date)).then((action) => {
      if (fetchStats.fulfilled.match(action)) {
        qc.setQueryData(['stats', date], action.payload.stats);
      }
    });
  };

  return (
    <aside className="right-panel dash-side">
      {current.task && current.mode !== 'live' && (
        <div className="side-now">
          <div className="side-now-kicker">
            {current.mode === 'now' ? 'Now' : 'Up next'}
          </div>
          <strong>{current.task.name}</strong>
          <span>
            {formatTimeRange(
              current.task.scheduledStart,
              current.task.scheduledEnd,
              user.timezone,
            )}
          </span>
          {current.task.status !== 'completed' && (
            <div className="side-now-actions">
              <button
                type="button"
                className="btn btn-primary btn-pill btn-sm"
                disabled={busy}
                onClick={() => {
                  const t = current.task!;
                  setBusy(true);
                  dispatch(tasksActions.optimisticStart({ taskId: t.id }));
                  void dispatch(
                    startTimerOptimistic({ taskId: t.id, date }),
                  ).finally(() => {
                    setBusy(false);
                    afterMutation();
                  });
                }}
              >
                Start
              </button>
              <button
                type="button"
                className="btn btn-outline btn-pill btn-sm"
                disabled={busy}
                onClick={() => {
                  const t = current.task!;
                  setBusy(true);
                  dispatch(tasksActions.optimisticComplete({ taskId: t.id }));
                  void dispatch(
                    completeTaskOptimistic({ taskId: t.id, date }),
                  ).finally(() => {
                    setBusy(false);
                    afterMutation();
                  });
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}

      <div className="side-card focus-card">
        <div className="side-card-label">
          Focus <HintMark id="side.focus" placement="left" />
        </div>
        <div
          className="focus-ring"
          style={{ ['--pct' as string]: focusScore }}
        >
          <strong>{focusScore}</strong>
          <span>Focus</span>
        </div>
        <p className="focus-blurb">
          {loadPct}% of work hours booked. Highest near 55%.
        </p>
      </div>

      <div className="side-card">
        <div className="side-card-label">Where the time went</div>
        <div className="time-went-bar">
          <i className="seg deep" style={{ width: `${deepPct}%` }} />
          <i className="seg meet" style={{ width: `${meetPct}%` }} />
          <i className="seg planned" style={{ width: `${plannedPct}%` }} />
          <i className="seg open" style={{ width: `${openPct}%` }} />
        </div>
        <ul className="time-went-legend">
          <li>
            <span className="swatch deep" /> Deep work{' '}
            <strong>{deepLogged}m</strong>
          </li>
          <li>
            <span className="swatch meet" /> Meetings{' '}
            <strong>{meetLogged}m</strong>
          </li>
          <li>
            <span className="swatch planned" /> Still planned{' '}
            <strong>{deepPlanned + meetPlanned}m</strong>
          </li>
          <li>
            <span className="swatch open" /> Open{' '}
            <strong>{openMins}m</strong>
          </li>
        </ul>
      </div>

      <div className="side-card">
        <div className="side-card-label">
          Load <HintMark id="side.load" placement="left" />
        </div>
        <div className="load-meta">
          <strong>{loadPct}%</strong>
          <span>of {Math.round(available / 60)}h</span>
        </div>
        <div className="load-track">
          <i style={{ width: `${loadPct}%` }} />
        </div>
        <div className="load-bars" aria-label="Weekly load">
          {weekDays.map((d, i) => (
            <div
              key={`${d.label}-${i}`}
              className={`load-col${d.isToday ? ' is-today' : ''}`}
            >
              <div className="load-bar-track">
                <i style={{ height: `${d.height}%` }} />
              </div>
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <CoachSlot
        content={coachContent}
        onMute={applyMute}
        onUnmute={clearMute}
        onShare={() => setShareOpen(true)}
      />

      <ShareStudio
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        week={shareWeek}
        initialTab="story"
      />
    </aside>
  );
}
