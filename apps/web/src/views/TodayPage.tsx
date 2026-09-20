'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, formatTimeRange, todayISO, parseInstant, shiftDateISO } from '../api';
import { MeetSourceBadge } from '../components/MeetSourceBadge';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  completeTaskOptimistic,
  createTaskOptimistic,
  fetchBacklog,
  fetchTasks,
  moveToBacklogOptimistic,
  removeTaskOptimistic,
  reorderTasksOptimistic,
  scheduleFromBacklogOptimistic,
  startTimerOptimistic,
  stopTimerOptimistic,
  tasksActions,
  updateTaskOptimistic,
} from '../store/tasksSlice';
import { fetchStats } from '../store/statsSlice';
import type {
  CalendarEventDto,
  DailyScheduleTemplateDto,
  StatsOverviewDto,
  TaskDto,
} from '@timeblock/shared-types';

const EMPTY_TASKS: TaskDto[] = [];
const MIN_PX_PER_MIN = 1.35;
const MAX_PX_PER_MIN = 2.8;

function parseHm(hm: string) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function formatHm(total: number) {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function sortDay(list: TaskDto[]): TaskDto[] {
  return [...list].sort((a, b) => {
    if (a.scheduledStart && b.scheduledStart) {
      return a.scheduledStart.localeCompare(b.scheduledStart);
    }
    if (a.scheduledStart) return -1;
    if (b.scheduledStart) return 1;
    return a.order - b.order;
  });
}

function combineIso(date: string, hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(`${date}T12:00:00`);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function isoFromMinutes(date: string, totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return combineIso(date, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}

/** Next free wall-clock slot so The plan paints instantly (before API pack). */
function nextOptimisticSlot(opts: {
  date: string;
  durationMin: number;
  tasks: TaskDto[];
  timeZone?: string | null;
  pinStart?: string;
  pinEnd?: string;
  breaks?: { start: string; end: string }[];
}): { scheduledStart: string; scheduledEnd: string } {
  if (opts.pinStart && opts.pinEnd) {
    return {
      scheduledStart: combineIso(opts.date, opts.pinStart),
      scheduledEnd: combineIso(opts.date, opts.pinEnd),
    };
  }
  const duration = Math.max(5, opts.durationMin);
  const now = nowMinutes(opts.timeZone);
  let cursor = Math.ceil((now + 1) / 15) * 15;
  for (const t of opts.tasks) {
    if (t.status === 'completed') continue;
    if (!t.scheduledEnd) continue;
    const end = minutesOf(t.scheduledEnd, opts.timeZone);
    if (end > cursor) cursor = end;
  }
  const breaks = opts.breaks ?? [];
  for (let pass = 0; pass < breaks.length + 2; pass++) {
    let moved = false;
    for (const b of breaks) {
      const bs = parseHm(b.start);
      const be = parseHm(b.end);
      if (be <= bs) continue;
      // Inside a break → jump to break end
      if (cursor >= bs && cursor < be) {
        cursor = be;
        moved = true;
      }
      // Would overlap a break → jump past it
      if (cursor < bs && cursor + duration > bs) {
        cursor = be;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const startMin = Math.min(cursor, 24 * 60 - duration);
  const endMin = Math.min(startMin + duration, 24 * 60 - 1);
  return {
    scheduledStart: isoFromMinutes(opts.date, startMin),
    scheduledEnd: isoFromMinutes(opts.date, endMin),
  };
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

export function TodayPage({
  timeZone,
  defaultTaskMinutes = 30,
}: {
  timeZone?: string | null;
  defaultTaskMinutes?: number;
}) {
  const today = todayISO(timeZone);
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const qc = useQueryClient();
  const dispatch = useAppDispatch();
  const [name, setName] = useState('');
  const [pinTime, setPinTime] = useState(false);
  const defaultStart = () => {
    const now = nowMinutes(timeZone);
    const rounded = Math.ceil((now + 1) / 15) * 15;
    return formatHm(Math.min(rounded, 23 * 60 + 45));
  };
  const defaultEnd = (startHm: string) => {
    const start = parseHm(startHm);
    return formatHm(Math.min(start + defaultTaskMinutes, 24 * 60 - 1));
  };
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(() => defaultEnd(defaultStart()));
  const [formError, setFormError] = useState<string | null>(null);
  const [createHint, setCreateHint] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const reduxTasks = useAppSelector((s) => s.tasks.byDate[date] ?? EMPTY_TASKS);
  const backlogTasks = useAppSelector((s) => s.tasks.backlog);
  const createPending = useAppSelector((s) =>
    s.tasks.pendingKeys.some((k) => k.startsWith('create:')),
  );
  const createErrorRedux = useAppSelector((s) => s.tasks.createError);

  // Keep "today" in sync when the civil day rolls over while viewing today
  useEffect(() => {
    if (isToday && date !== today) setDate(today);
  }, [today, isToday, date]);

  useEffect(() => {
    const focusNew = () => {
      nameInputRef.current?.focus();
      nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    if (window.location.hash === '#new-task') focusNew();
    window.addEventListener('hashchange', focusNew);
    return () => window.removeEventListener('hashchange', focusNew);
  }, []);

  // Redux: load day + backlog (optimistic UI reads from store)
  useEffect(() => {
    void dispatch(fetchTasks(date));
  }, [dispatch, date]);

  useEffect(() => {
    void dispatch(fetchBacklog());
  }, [dispatch]);

  useEffect(() => {
    if (createErrorRedux) setFormError(createErrorRedux);
  }, [createErrorRedux]);

  const eventsQ = useQuery({
    queryKey: ['events', date],
    queryFn: () =>
      api.get<CalendarEventDto[]>(`/api/calendar/events?date=${date}`),
  });
  const statsQ = useQuery({
    queryKey: ['stats', date],
    queryFn: () =>
      api.get<StatsOverviewDto>(`/api/stats/overview?date=${date}`),
  });
  const scheduleQ = useQuery({
    queryKey: ['schedule'],
    queryFn: async () => {
      const rows = await api.get<DailyScheduleTemplateDto[]>('/api/schedule');
      return Array.isArray(rows) ? rows : [];
    },
    retry: 2,
  });

  const invalidateStats = () => {
    void qc.invalidateQueries({ queryKey: ['stats', date] });
    void qc.invalidateQueries({ queryKey: ['eod', date] });
    void qc.invalidateQueries({ queryKey: ['weekly'] });
    void qc.invalidateQueries({ queryKey: ['events', date] });
    void dispatch(fetchStats(date)).then((action) => {
      if (fetchStats.fulfilled.match(action)) {
        qc.setQueryData(['stats', date], action.payload.stats);
      }
    });
  };

  const refreshDay = () => {
    void dispatch(fetchTasks(date));
    void dispatch(fetchBacklog());
    invalidateStats();
  };

  const submitNewTask = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Enter a task name to add it.');
      nameInputRef.current?.focus();
      return;
    }
    let estimatedMinutes = defaultTaskMinutes;
    let start: string | undefined;
    let end: string | undefined;
    if (pinTime) {
      if (!startTime || !endTime) {
        setFormError('Pick a start and end time.');
        return;
      }
      const startMin = parseHm(startTime);
      const endMin = parseHm(endTime);
      if (!(endMin > startMin)) {
        setFormError('End time must be after start time.');
        return;
      }
      const mins = endMin - startMin;
      if (mins < 5) {
        setFormError('Slot must be at least 5 minutes.');
        return;
      }
      estimatedMinutes = mins;
      start = startTime;
      end = endTime;
    }

    const tid = tasksActions.tempId();
    const weekdayNow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const dayTemplate = scheduleQ.data?.find((t) => t.weekday === weekdayNow);
    const slot = nextOptimisticSlot({
      date,
      durationMin: estimatedMinutes,
      tasks: reduxTasks,
      timeZone,
      pinStart: start,
      pinEnd: end,
      breaks: dayTemplate?.breaks?.map((b) => ({
        start: b.start,
        end: b.end,
      })),
    });

    setFormError(null);
    setCreateHint(null);
    setName('');
    dispatch(tasksActions.clearCreateError());
    // Paint The plan + Queue immediately with a provisional slot
    dispatch(
      tasksActions.optimisticCreate({
        tempId: tid,
        date,
        name: trimmed,
        estimatedMinutes,
        scheduledStart: slot.scheduledStart,
        scheduledEnd: slot.scheduledEnd,
        scheduleLocked: Boolean(start && end),
      }),
    );
    const nextStart = defaultStart();
    setStartTime(nextStart);
    setEndTime(defaultEnd(nextStart));
    nameInputRef.current?.focus();

    void dispatch(
      createTaskOptimistic({
        date,
        name: trimmed,
        estimatedMinutes,
        startTime: start,
        endTime: end,
        tempId: tid,
      }),
    ).then((result) => {
      if (createTaskOptimistic.fulfilled.match(result)) {
        const task = result.payload.task;
        if (task.inBacklog) {
          setCreateHint(
            `"${task.name}" had no free work-hour slot — check Backlog or Pin time.`,
          );
        }
        // Reconcile packing with server in the background (UI already updated)
        void dispatch(fetchTasks(date));
        void dispatch(fetchBacklog());
        invalidateStats();
      }
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const tasks = useMemo(() => sortDay(reduxTasks), [reduxTasks]);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const template = scheduleQ.data?.find((t) => t.weekday === weekday);

  const dayStartMin = template ? parseHm(template.workStart) : null;
  const dayEndMin = template ? parseHm(template.workEnd) : null;
  const hasSchedule = dayStartMin !== null && dayEndMin !== null;

  // Expand timeline to cover work hours, every scheduled block, and “now”
  const { viewStartMin, viewEndMin } = useMemo(() => {
    if (!hasSchedule) {
      return {
        viewStartMin: null as number | null,
        viewEndMin: null as number | null,
      };
    }
    let start = dayStartMin!;
    let end = dayEndMin!;
    const bump = (value: number) => {
      if (!Number.isFinite(value)) return;
      start = Math.min(start, value);
      end = Math.max(end, value);
    };
    for (const ev of eventsQ.data ?? []) {
      bump(minutesOf(ev.start, timeZone));
      bump(minutesOf(ev.end, timeZone));
    }
    for (const t of tasks) {
      if (t.scheduledStart) bump(minutesOf(t.scheduledStart, timeZone));
      if (t.scheduledEnd) bump(minutesOf(t.scheduledEnd, timeZone));
    }
    if (isToday) {
      const now = nowMinutes(timeZone);
      bump(now);
      end = Math.max(end, now + 120);
    }
    // Keep a little padding so evening cards aren’t flush to the edge
    end = Math.max(end, dayEndMin! + 30);
    start = Math.max(0, Math.floor(start / 60) * 60);
    end = Math.min(24 * 60, Math.ceil(end / 60) * 60);
    if (end <= start) end = start + 60;
    return { viewStartMin: start, viewEndMin: end };
  }, [
    hasSchedule,
    dayStartMin,
    dayEndMin,
    eventsQ.data,
    tasks,
    timeZone,
    isToday,
  ]);

  const span =
    viewStartMin !== null && viewEndMin !== null
      ? Math.max(viewEndMin - viewStartMin, 60)
      : 0;

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportH, setViewportH] = useState(560);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight || 560);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasSchedule]);

  // Prefer readable block height; scroll when the day is long (don’t crush evening)
  const pxPerMin = useMemo(() => {
    if (!span) return 1.4;
    const usable = Math.max(viewportH - 8, 320);
    const fit = usable / span;
    // Never go below readable size — timeline scrolls instead
    return Math.min(MAX_PX_PER_MIN, Math.max(MIN_PX_PER_MIN, fit));
  }, [span, viewportH]);

  // Scroll plan to “now” (or first post-work task) so evening blocks aren’t off-screen
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || viewStartMin == null || !span) return;
    const targetMin = isToday
      ? Math.max(nowMinutes(timeZone) - 30, viewStartMin)
      : viewStartMin;
    const top = Math.max(0, (targetMin - viewStartMin) * pxPerMin - 24);
    el.scrollTo({ top, behavior: 'smooth' });
  }, [date, viewStartMin, pxPerMin, span, isToday, timeZone, tasks.length]);

  const hourMarks = useMemo(() => {
    if (viewStartMin === null || viewEndMin === null) return [];
    const marks: number[] = [];
    const startH = Math.floor(viewStartMin / 60);
    const endH = Math.ceil(viewEndMin / 60);
    for (let h = startH; h <= endH; h++) marks.push(h * 60);
    return marks;
  }, [viewStartMin, viewEndMin]);

  const nowMin = nowMinutes(timeZone);
  const showNow =
    viewStartMin !== null &&
    viewEndMin !== null &&
    nowMin >= viewStartMin &&
    nowMin <= viewEndMin;

  // Prefer locked Meet tasks on the timeline; only draw orphan calendar events
  const orphanEvents = useMemo(() => {
    const locked = tasks.filter((t) => t.scheduleLocked && t.scheduledStart);
    return (eventsQ.data ?? []).filter((ev) => {
      const es = minutesOf(ev.start, timeZone);
      return !locked.some((t) => {
        const ts = minutesOf(t.scheduledStart!, timeZone);
        return Math.abs(ts - es) < 2;
      });
    });
  }, [eventsQ.data, tasks, timeZone]);

  const timelineH = span * pxPerMin;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    if (tasks[oldIndex]?.scheduleLocked || tasks[newIndex]?.scheduleLocked) {
      return;
    }
    const previous = tasks;
    const next = arrayMove(tasks, oldIndex, newIndex);
    dispatch(tasksActions.optimisticReorder({ date, tasks: next }));
    const unlockedIds = next.filter((t) => !t.scheduleLocked).map((t) => t.id);
    void dispatch(
      reorderTasksOptimistic({
        date,
        taskIds: unlockedIds,
        previous,
      }),
    ).then(() => invalidateStats());
  };

  const dateLabel = useMemo(() => {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, [date]);

  const liveTask = useMemo(
    () => tasks.find((t) => t.activeEntryId) ?? null,
    [tasks],
  );
  const heroTask = useMemo(() => {
    if (liveTask) return { task: liveTask, mode: 'live' as const };
    if (!isToday) return null;
    const now = nowMinutes(timeZone);
    const inSlot = tasks
      .filter(
        (t) =>
          !t.inBacklog &&
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
    if (inSlot) return { task: inSlot, mode: 'now' as const };
    const next = tasks
      .filter(
        (t) =>
          !t.inBacklog &&
          t.status !== 'completed' &&
          t.scheduledStart &&
          minutesOf(t.scheduledStart, timeZone) > now,
      )
      .sort(
        (a, b) =>
          minutesOf(a.scheduledStart!, timeZone) -
          minutesOf(b.scheduledStart!, timeZone),
      )[0];
    if (next) return { task: next, mode: 'next' as const };
    return null;
  }, [liveTask, tasks, isToday, timeZone]);
  const loggedSessions = useMemo(
    () =>
      tasks
        .filter((t) => t.actualMinutes > 0)
        .sort((a, b) => b.actualMinutes - a.actualMinutes)
        .slice(0, 5),
    [tasks],
  );
  const estMinutes = useMemo(
    () =>
      tasks
        .filter((t) => !t.inBacklog)
        .reduce((s, t) => s + t.estimatedMinutes, 0),
    [tasks],
  );
  const actualMinutes = useMemo(
    () => tasks.reduce((s, t) => s + (t.actualMinutes || 0), 0),
    [tasks],
  );
  const sessionCount = loggedSessions.length;
  const longestSession = loggedSessions[0]?.actualMinutes ?? 0;
  const finishLabel = useMemo(() => {
    const pendingEnds = tasks
      .filter((t) => t.scheduledEnd && t.status !== 'completed' && !t.inBacklog)
      .map((t) => minutesOf(t.scheduledEnd!, timeZone));
    if (pendingEnds.length) return formatHm(Math.max(...pendingEnds));
    const allEnds = tasks
      .filter((t) => t.scheduledEnd && !t.inBacklog)
      .map((t) => minutesOf(t.scheduledEnd!, timeZone));
    if (!allEnds.length) return '—';
    return formatHm(Math.max(...allEnds));
  }, [tasks, timeZone]);

  const formatDur = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `${m}m`;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  };

  return (
    <div className="today-page dash-page">
      {heroTask && (
        <SessionBanner
          task={heroTask.task}
          mode={heroTask.mode}
          timeZone={timeZone}
          onChanged={refreshDay}
        />
      )}

      <div className="dash-grid">
        <section className="dash-col dash-plan">
          <div className="dash-col-head">
            <div>
              <h2 className="dash-col-title">The plan</h2>
              <p className="dash-col-sub">{dateLabel}</p>
            </div>
            <div className="date-nav">
              <button
                type="button"
                className="btn btn-ghost btn-sm date-nav-btn"
                aria-label="Previous day"
                onClick={() => setDate((d) => shiftDateISO(d, -1))}
              >
                ‹
              </button>
              {!isToday && (
                <button
                  type="button"
                  className="btn btn-outline btn-pill btn-sm"
                  onClick={() => setDate(today)}
                >
                  Today
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm date-nav-btn"
                aria-label="Next day"
                onClick={() => setDate((d) => shiftDateISO(d, 1))}
              >
                ›
              </button>
            </div>
          </div>

          <div className="schedule-board schedule-board--fill plan-board">
            {!hasSchedule ? (
              <div className="card" style={{ padding: 16 }}>
                No work hours for today. Open Settings and save a daily schedule
                profile for this weekday.
              </div>
            ) : (
              <div className="day-timeline-viewport" ref={viewportRef}>
                <div className="day-timeline plan-timeline" style={{ height: timelineH }}>
                  <div className="day-timeline-hours">
                    {hourMarks.map((m) => (
                      <div
                        key={m}
                        className="day-timeline-hour"
                        style={{ top: (m - viewStartMin!) * pxPerMin }}
                      >
                        {formatHm(m)}
                      </div>
                    ))}
                  </div>
                  <div className="day-timeline-track">
                    <div className="plan-rail" aria-hidden />

                    {hourMarks.map((m) => (
                      <div
                        key={`line-${m}`}
                        className="day-timeline-line"
                        style={{ top: (m - viewStartMin!) * pxPerMin }}
                      />
                    ))}

                    {(template?.breaks ?? []).map((b) => {
                      const s = Math.max(parseHm(b.start), viewStartMin!);
                      const e = Math.min(parseHm(b.end), viewEndMin!);
                      if (e <= s) return null;
                      const h = Math.max((e - s) * pxPerMin, 28);
                      const isLunch = /lunch/i.test(b.name);
                      return (
                        <div
                          key={b.id}
                          className={`cal-block break${isLunch ? ' is-lunch' : ' is-break'}`}
                          style={{
                            top: (s - viewStartMin!) * pxPerMin,
                            height: h,
                          }}
                        >
                          <div className="cal-block-main">
                            <span className="cal-kicker">
                              {isLunch ? 'Lunch' : 'Break'}
                            </span>
                            <strong>{b.name}</strong>
                          </div>
                          <span className="cal-time-end">
                            {b.start}–{b.end}
                          </span>
                        </div>
                      );
                    })}

                    {orphanEvents.map((ev) => {
                      const s = Math.max(
                        minutesOf(ev.start, timeZone),
                        viewStartMin!,
                      );
                      const e = Math.min(
                        minutesOf(ev.end, timeZone),
                        viewEndMin!,
                      );
                      if (e <= viewStartMin! || s >= viewEndMin!) return null;
                      return (
                        <div
                          key={ev.id}
                          className={`cal-block busy${ev.meetLink ? ' meet' : ''}`}
                          style={{
                            top: (s - viewStartMin!) * pxPerMin,
                            height: Math.max((e - s) * pxPerMin, 44),
                          }}
                        >
                          <div className="cal-block-main">
                            <strong>
                              {ev.title}
                              {ev.meetLink ? (
                                <span className="cal-provider">Google</span>
                              ) : null}
                            </strong>
                            <span className="cal-meta">
                              {formatTimeRange(ev.start, ev.end, timeZone)}
                            </span>
                          </div>
                          <span className="cal-time-end">
                            {formatHm(s)}
                          </span>
                        </div>
                      );
                    })}

                    {tasks
                      .filter((t) => t.scheduledStart && t.scheduledEnd)
                      .map((t) => {
                        const rawS = minutesOf(t.scheduledStart!, timeZone);
                        const rawE = minutesOf(t.scheduledEnd!, timeZone);
                        const s = Math.max(rawS, viewStartMin!);
                        const e = Math.min(rawE, viewEndMin!);
                        if (e <= s) return null;
                        const meet = Boolean(t.scheduleLocked || t.meetLink);
                        const isLive = Boolean(t.activeEntryId);
                        const done = t.status === 'completed';
                        const spanMin = Math.max(5, rawE - rawS);
                        const progress = isLive
                          ? Math.min(
                              100,
                              Math.round(
                                ((t.actualMinutes || 0) /
                                  Math.max(t.estimatedMinutes, 1)) *
                                  100,
                              ),
                            )
                          : 0;
                        return (
                          <div
                            key={t.id}
                            className={`cal-block ${
                              meet ? 'busy meet' : 'task'
                            }${done ? ' is-done' : ''}${
                              isLive ? ' is-live' : ''
                            }`}
                            style={{
                              top: (s - viewStartMin!) * pxPerMin,
                              height: Math.max((e - s) * pxPerMin, 52),
                            }}
                          >
                            <div className="cal-block-main">
                              {isLive && (
                                <span className="cal-live-tag">
                                  ● In session · {t.actualMinutes || 0}m
                                </span>
                              )}
                              <strong>
                                {t.name}
                                {done ? ' ✓' : ''}
                                {meet && t.sourceProvider ? (
                                  <span className="cal-provider">
                                    {String(t.sourceProvider)}
                                  </span>
                                ) : null}
                              </strong>
                              {!meet && (
                                <span className="cal-meta">
                                  {formatTimeRange(
                                    t.scheduledStart,
                                    t.scheduledEnd,
                                    timeZone,
                                  )}
                                  {' · '}
                                  {spanMin}m
                                  {!t.scheduleLocked ? ' · Deep work' : ''}
                                </span>
                              )}
                              {isLive && (
                                <div className="cal-progress">
                                  <i style={{ width: `${progress}%` }} />
                                </div>
                              )}
                            </div>
                            <span className="cal-time-end">
                              {formatHm(rawS)}
                              {meet ? '' : `–${formatHm(rawE)}`}
                            </span>
                          </div>
                        );
                      })}

                    {showNow && (
                      <div
                        className="day-now-line"
                        style={{ top: (nowMin - viewStartMin!) * pxPerMin }}
                        aria-hidden
                      >
                        <span className="day-now-dot" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="plan-reality plan-reality-mock">
            <div className="plan-reality-grid">
              <div>
                <span className="label">Estimated today</span>
                <strong>{formatDur(estMinutes)}</strong>
              </div>
              <div>
                <span className="label">Actual so far</span>
                <strong>
                  {formatDur(actualMinutes)}
                  {estMinutes > 0 && actualMinutes > 0 ? (
                    <em
                      className={
                        actualMinutes < estMinutes * 0.5
                          ? 'is-behind'
                          : undefined
                      }
                    >
                      {actualMinutes >= estMinutes
                        ? 'on pace'
                        : `${formatDur(estMinutes - actualMinutes)} left`}
                    </em>
                  ) : null}
                </strong>
              </div>
              <div>
                <span className="label">Sessions</span>
                <strong>
                  {sessionCount}
                  {longestSession ? (
                    <em>longest {longestSession}m</em>
                  ) : null}
                </strong>
              </div>
              <div>
                <span className="label">Finishes at</span>
                <strong>{finishLabel}</strong>
              </div>
            </div>
            <button
              type="button"
              className="plan-fill-btn"
              onClick={() => nameInputRef.current?.focus()}
            >
              Fill the gap
            </button>
          </div>
        </section>

        <section className="dash-col dash-queue">
          <div className="dash-col-head">
            <div>
              <h2 className="dash-col-title">Queue</h2>
              <p className="dash-col-sub">
                {statsQ.data?.today.pending ?? 0} pending ·{' '}
                {statsQ.data?.today.completed ?? 0} done
              </p>
            </div>
          </div>

          <form
            className={`add-task-composer${pinTime ? ' is-pinning' : ''}`}
            onSubmit={submitNewTask}
          >
            <input
              ref={nameInputRef}
              id="new-task-name"
              className="add-task-input"
              placeholder="Add a task…"
              value={name}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setName(e.target.value);
                if (formError) setFormError(null);
                if (createHint) setCreateHint(null);
              }}
              aria-invalid={Boolean(formError)}
            />
            <span className="add-task-dur" title="Default duration">
              {pinTime
                ? `${Math.max(5, parseHm(endTime) - parseHm(startTime))}m`
                : `${defaultTaskMinutes}m`}
            </span>
            <button
              type="button"
              className={`add-task-pin-btn${pinTime ? ' is-on' : ''}`}
              aria-pressed={pinTime}
              onClick={() => setPinTime((v) => !v)}
            >
              Pin
            </button>
            {pinTime && (
              <div className="add-task-times" aria-label="Task time range">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStartTime(next);
                    if (formError) setFormError(null);
                    if (parseHm(endTime) <= parseHm(next)) {
                      setEndTime(defaultEnd(next));
                    }
                  }}
                  step={300}
                  aria-label="Start time"
                />
                <span className="add-task-times-sep" aria-hidden>
                  –
                </span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  step={300}
                  aria-label="End time"
                />
              </div>
            )}
            <button
              className="btn btn-primary btn-pill add-task-submit"
              type="submit"
              disabled={createPending || !name.trim()}
            >
              {createPending ? 'Adding' : 'Add'}
            </button>
          </form>
          {(formError || createErrorRedux) && (
            <p className="composer-hint is-error">
              {formError || createErrorRedux || 'Could not add task'}
            </p>
          )}
          {createHint && !formError && (
            <p className="composer-hint">{createHint}</p>
          )}

          <div className="queue-scroll">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={tasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="priority-list queue-list">
                  {tasks.map((task, i) => (
                    <SortableTask
                      key={task.id}
                      task={task}
                      rank={i + 1}
                      timeZone={timeZone}
                      onChanged={refreshDay}
                    />
                  ))}
                  {tasks.length === 0 && (
                    <div className="priority-empty">
                      No tasks yet — add one above.
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>

            {loggedSessions.length > 0 && (
              <div className="captured-sessions">
                <h3 className="section-label">Captured sessions</h3>
                <ul>
                  {loggedSessions.map((t) => (
                    <li key={t.id}>
                      <span className="captured-dot" aria-hidden />
                      <div>
                        <strong>{t.name}</strong>
                        <span>{t.actualMinutes}m captured</span>
                      </div>
                      <em>{t.actualMinutes}m</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <BacklogSection
              tasks={backlogTasks}
              loading={false}
              today={today}
              timeZone={timeZone}
              onChanged={refreshDay}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function SessionBanner({
  task,
  mode,
  timeZone,
  onChanged,
}: {
  task: TaskDto;
  mode: 'live' | 'now' | 'next';
  timeZone?: string | null;
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  const [liveSec, setLiveSec] = useState(0);
  useEffect(() => {
    if (mode !== 'live') {
      setLiveSec(0);
      return;
    }
    setLiveSec(0);
    const id = window.setInterval(() => setLiveSec((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [task.id, task.activeEntryId, mode]);

  const elapsedSec =
    mode === 'live'
      ? Math.max(0, (task.actualMinutes || 0) * 60 + liveSec)
      : Math.max(0, (task.actualMinutes || 0) * 60);
  const totalSec = Math.max(5, task.estimatedMinutes) * 60;
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');
  const pct = Math.min(100, Math.round((elapsedSec / totalSec) * 100));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const tag =
    mode === 'live' ? 'In session' : mode === 'now' ? 'Now' : 'Up next';
  const kind = task.scheduleLocked || task.meetLink ? 'Meeting' : 'Deep work';

  return (
    <div className={`session-banner is-${mode}`}>
      <div className="session-banner-main">
        <div className="session-banner-copy">
          <div className="session-title-row">
            <h2>{task.name}</h2>
            <span className="session-live-tag">
              <i aria-hidden /> {tag}
            </span>
          </div>
          <p className="session-sub">
            {kind}
            {task.scheduledStart && task.scheduledEnd
              ? ` · planned ${formatTimeRange(task.scheduledStart, task.scheduledEnd, timeZone)}`
              : ''}
          </p>
        </div>
        <div className="session-elapsed">
          <div className="session-elapsed-meta">
            <span>Elapsed</span>
            <span>
              {pct}% of {task.estimatedMinutes}m
            </span>
          </div>
          <div className="session-progress">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="session-banner-actions">
        <div className="session-timer" aria-label="Elapsed time">
          {mm}:{ss}
        </div>
        {mode === 'live' ? (
          <button
            type="button"
            className="btn btn-outline btn-pill session-pause"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                dispatch(tasksActions.optimisticStop({ taskId: task.id }));
                await dispatch(
                  stopTimerOptimistic({ taskId: task.id, date: task.date }),
                );
              })
            }
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-outline btn-pill session-pause"
            disabled={busy || task.status === 'completed'}
            onClick={() =>
              void run(async () => {
                dispatch(tasksActions.optimisticStart({ taskId: task.id }));
                await dispatch(
                  startTimerOptimistic({ taskId: task.id, date: task.date }),
                );
              })
            }
          >
            Start
          </button>
        )}
        <button
          type="button"
          className="btn btn-pill session-done"
          disabled={busy || task.status === 'completed'}
          onClick={() =>
            void run(async () => {
              dispatch(tasksActions.optimisticComplete({ taskId: task.id }));
              await dispatch(
                completeTaskOptimistic({ taskId: task.id, date: task.date }),
              );
            })
          }
        >
          Done
        </button>
      </div>
    </div>
  );
}


function formatBacklogDay(dateStr: string, timeZone?: string | null) {
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: timeZone || undefined,
    });
  } catch {
    return dateStr;
  }
}

function BacklogSection({
  tasks,
  loading,
  today,
  timeZone,
  onChanged,
}: {
  tasks: TaskDto[];
  loading: boolean;
  today: string;
  timeZone?: string | null;
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (taskId: string, fn: () => Promise<unknown>) => {
    setBusyId(taskId);
    try {
      await fn();
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="priority-section backlog-section">
      <div className="priority-header">
        <div>
          <h3 className="section-label" style={{ marginBottom: 2 }}>
            Backlog
          </h3>
          <p className="priority-sub">
            Unfinished or unscheduled — pick up when you have room.
          </p>
        </div>
        {tasks.length > 0 && (
          <span className="priority-count">{tasks.length}</span>
        )}
      </div>
      {loading && <div className="priority-empty">Loading…</div>}
      {!loading && tasks.length === 0 && (
        <div className="priority-empty">Nothing waiting.</div>
      )}
      <div className="backlog-list">
        {tasks.map((task) => (
          <div key={task.id} className="backlog-row">
            <div className="backlog-body">
              <strong className="backlog-title">{task.name}</strong>
              <span className="backlog-meta">
                {task.estimatedMinutes}m
                {task.date !== today
                  ? ` · from ${formatBacklogDay(task.date, timeZone)}`
                  : ''}
              </span>
            </div>
            <div className="backlog-actions">
              <button
                className="btn btn-primary btn-pill btn-sm"
                type="button"
                disabled={busyId === task.id}
                onClick={() =>
                  void run(task.id, async () => {
                    dispatch(
                      tasksActions.optimisticScheduleFromBacklog({
                        taskId: task.id,
                        date: today,
                      }),
                    );
                    await dispatch(
                      scheduleFromBacklogOptimistic({
                        taskId: task.id,
                        date: today,
                      }),
                    );
                  })
                }
              >
                Schedule
              </button>
              <button
                className="btn btn-ghost btn-sm backlog-quiet"
                type="button"
                disabled={busyId === task.id}
                onClick={() =>
                  void run(task.id, async () => {
                    dispatch(
                      tasksActions.optimisticComplete({ taskId: task.id }),
                    );
                    await dispatch(
                      completeTaskOptimistic({
                        taskId: task.id,
                        date: task.date,
                      }),
                    );
                  })
                }
              >
                Done
              </button>
              <button
                className="btn btn-ghost btn-sm backlog-quiet"
                type="button"
                disabled={busyId === task.id}
                onClick={() =>
                  void run(task.id, async () => {
                    dispatch(
                      tasksActions.optimisticRemoveFromDay({
                        taskId: task.id,
                        date: task.date,
                      }),
                    );
                    await dispatch(
                      removeTaskOptimistic({
                        taskId: task.id,
                        date: today,
                      }),
                    );
                  })
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function SortableTask({
  task,
  timeZone,
  onChanged,
}: {
  task: TaskDto;
  rank?: number;
  timeZone?: string | null;
  onChanged: () => void;
}) {
  const locked = Boolean(task.scheduleLocked);
  const done = task.status === 'completed';
  const running = Boolean(task.activeEntryId);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.name);
  const [minsDraft, setMinsDraft] = useState(String(task.estimatedMinutes));
  const [startDraft, setStartDraft] = useState(() =>
    task.scheduledStart
      ? formatHm(minutesOf(task.scheduledStart, timeZone))
      : '',
  );
  const [endDraft, setEndDraft] = useState(() =>
    task.scheduledEnd
      ? formatHm(minutesOf(task.scheduledEnd, timeZone))
      : '',
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [draft, setDraft] = useState(task.notes ?? '');
  const [appendText, setAppendText] = useState('');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: locked || done });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    setDraft(task.notes ?? '');
    setNameDraft(task.name);
    setMinsDraft(String(task.estimatedMinutes));
    if (task.scheduledStart && task.scheduledEnd) {
      setStartDraft(formatHm(minutesOf(task.scheduledStart, timeZone)));
      setEndDraft(formatHm(minutesOf(task.scheduledEnd, timeZone)));
    } else {
      setStartDraft('');
      setEndDraft('');
    }
  }, [
    task.notes,
    task.name,
    task.estimatedMinutes,
    task.scheduledStart,
    task.scheduledEnd,
    task.id,
    timeZone,
  ]);

  const dispatch = useAppDispatch();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (fn: () => Promise<unknown>) => {
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await fn();
      // RTK thunks return actions; unwrap-style check
      if (
        result &&
        typeof result === 'object' &&
        'type' in result &&
        String((result as { type: string }).type).endsWith('/rejected')
      ) {
        const payload = (result as { payload?: { message?: string } }).payload;
        throw new Error(payload?.message || 'Action failed');
      }
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionBusy(false);
    }
  };

  const busy = actionBusy;
  const hasNotes = Boolean(task.notes?.trim());
  const dirty = draft !== (task.notes ?? '');

  const onAppendComment = () => {
    const line = appendText.trim();
    if (!line) return;
    const stamp = new Date().toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timeZone || undefined,
    });
    const next = [draft.trim(), draft.trim() ? '' : null, `[${stamp}]`, line]
      .filter((x) => x != null)
      .join('\n');
    setDraft(next);
    void runAction(async () => {
      dispatch(
        tasksActions.optimisticPatch({
          taskId: task.id,
          patch: { notes: next },
        }),
      );
      await dispatch(
        updateTaskOptimistic({
          taskId: task.id,
          date: task.date,
          body: { notes: next },
        }),
      );
      setAppendText('');
    });
  };

  const resetEditDrafts = () => {
    setNameDraft(task.name);
    setMinsDraft(String(task.estimatedMinutes));
    if (task.scheduledStart && task.scheduledEnd) {
      setStartDraft(formatHm(minutesOf(task.scheduledStart, timeZone)));
      setEndDraft(formatHm(minutesOf(task.scheduledEnd, timeZone)));
    } else {
      setStartDraft('');
      setEndDraft('');
    }
    setEditError(null);
    setEditing(false);
  };

  const saveEdits = () => {
    const name = nameDraft.trim();
    if (!name) {
      setEditError('Name is required.');
      return;
    }

    const body: {
      name?: string;
      estimatedMinutes?: number;
      startTime?: string;
      endTime?: string;
    } = {};
    if (name !== task.name) body.name = name;

    const hasTimes = Boolean(startDraft && endDraft);
    if (hasTimes) {
      const startMin = parseHm(startDraft);
      const endMin = parseHm(endDraft);
      if (!(endMin > startMin)) {
        setEditError('End time must be after start time.');
        return;
      }
      const mins = endMin - startMin;
      if (mins < 5) {
        setEditError('Slot must be at least 5 minutes.');
        return;
      }
      const prevStart =
        task.scheduledStart != null
          ? formatHm(minutesOf(task.scheduledStart, timeZone))
          : '';
      const prevEnd =
        task.scheduledEnd != null
          ? formatHm(minutesOf(task.scheduledEnd, timeZone))
          : '';
      if (startDraft !== prevStart || endDraft !== prevEnd) {
        body.startTime = startDraft;
        body.endTime = endDraft;
      } else {
        const minsNum = Number(minsDraft);
        if (
          Number.isFinite(minsNum) &&
          minsNum >= 5 &&
          Math.round(minsNum) !== task.estimatedMinutes
        ) {
          body.estimatedMinutes = Math.round(minsNum);
        }
      }
    } else {
      const mins = Number(minsDraft);
      if (
        Number.isFinite(mins) &&
        mins >= 5 &&
        Math.round(mins) !== task.estimatedMinutes
      ) {
        body.estimatedMinutes = Math.round(mins);
      }
    }

    if (!Object.keys(body).length) {
      setEditing(false);
      setEditError(null);
      return;
    }
    setEditError(null);
    void runAction(async () => {
      dispatch(
        tasksActions.optimisticPatch({
          taskId: task.id,
          patch: {
            name: body.name ?? task.name,
            estimatedMinutes: body.estimatedMinutes ?? task.estimatedMinutes,
          },
        }),
      );
      await dispatch(
        updateTaskOptimistic({
          taskId: task.id,
          date: task.date,
          body,
        }),
      );
      setEditing(false);
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'priority-row',
        locked ? 'is-meet' : 'is-task',
        done ? 'is-done' : '',
        running ? 'is-running' : '',
        isDragging ? 'is-dragging' : '',
        commentsOpen ? 'is-comments-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {locked ? (
        <span className="priority-grip is-locked" title="Fixed meeting time" aria-hidden>
          ⌖
        </span>
      ) : (
        <button
          type="button"
          className="priority-grip"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <span className="grip-dots" aria-hidden>
            ⋮⋮
          </span>
        </button>
      )}

      <button
        type="button"
        className={`queue-check${done ? ' is-checked' : ''}`}
        aria-label={done ? 'Completed' : 'Mark complete'}
        disabled={done || busy}
        onClick={() =>
          void runAction(async () => {
            dispatch(tasksActions.optimisticComplete({ taskId: task.id }));
            await dispatch(
              completeTaskOptimistic({ taskId: task.id, date: task.date }),
            );
          })
        }
      >
        {done ? '✓' : ''}
      </button>

      <div className="priority-body">
        <div className="priority-title-row">
          {editing && !locked ? (
            <input
              className="priority-title-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveEdits();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
            />
          ) : (
            <strong
              className="priority-title"
              title={locked ? undefined : 'Click to rename'}
              onClick={() => {
                if (!locked && !done) setEditing(true);
              }}
              style={{ cursor: locked || done ? undefined : 'text' }}
            >
              {task.name}
            </strong>
          )}
          {locked && (
            <MeetSourceBadge
              sourceProvider={task.sourceProvider}
              meetLink={task.meetLink}
            />
          )}
          {running && <span className="priority-badge live">Live</span>}
          {hasNotes && !commentsOpen && (
            <span className="priority-badge notes" title="Has comments">
              Notes
            </span>
          )}
        </div>
        <div className="priority-meta">
          <span className="queue-cat">
            {locked || task.meetLink ? 'Meeting' : 'Deep work'}
          </span>
          {editing && !locked ? (
            <span className="priority-time-edit" aria-label="Task time range">
              <input
                className="priority-time-input"
                type="time"
                value={startDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setStartDraft(next);
                  const mins = Number(minsDraft);
                  if (next && Number.isFinite(mins) && mins >= 5) {
                    setEndDraft(
                      formatHm(
                        Math.min(parseHm(next) + Math.round(mins), 24 * 60 - 1),
                      ),
                    );
                  }
                }}
                aria-label="Start time"
              />
              <span className="priority-time-sep">–</span>
              <input
                className="priority-time-input"
                type="time"
                value={endDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setEndDraft(next);
                  if (startDraft && next) {
                    const span = parseHm(next) - parseHm(startDraft);
                    if (span >= 5) setMinsDraft(String(span));
                  }
                }}
                aria-label="End time"
              />
              <span className="priority-time-sep">·</span>
              <input
                className="priority-mins-input"
                type="number"
                min={5}
                step={5}
                value={minsDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setMinsDraft(next);
                  const mins = Number(next);
                  if (startDraft && Number.isFinite(mins) && mins >= 5) {
                    setEndDraft(
                      formatHm(
                        Math.min(parseHm(startDraft) + Math.round(mins), 24 * 60 - 1),
                      ),
                    );
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEdits();
                  }
                }}
                aria-label="Duration minutes"
              />
              <span>m</span>
            </span>
          ) : (
            <>
              <button
                type="button"
                className="priority-time-btn"
                onClick={() => {
                  if (!locked && !done) setEditing(true);
                }}
                disabled={locked || done}
                title={locked ? undefined : 'Edit time'}
              >
                {formatTimeRange(task.scheduledStart, task.scheduledEnd, timeZone)}
              </button>
              {!locked && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="priority-mins-btn"
                    onClick={() => setEditing(true)}
                    disabled={done}
                  >
                    {task.estimatedMinutes}m
                  </button>
                </>
              )}
            </>
          )}
          {task.actualMinutes > 0 ? ` · ${task.actualMinutes}m actual` : ''}
          {editing && !locked && (
            <span className="priority-edit-actions">
              <button
                type="button"
                className="btn btn-primary btn-pill btn-sm"
                disabled={busy}
                onClick={saveEdits}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-pill btn-sm"
                onClick={resetEditDrafts}
              >
                Cancel
              </button>
            </span>
          )}
        </div>
        {actionError && (
          <div className="priority-error">{editError || actionError}</div>
        )}
        {editError && !actionError && (
          <div className="priority-error">{editError}</div>
        )}

        {commentsOpen && (
          <div className="task-comments">
            <label className="task-comments-label" htmlFor={`notes-${task.id}`}>
              Comments
            </label>
            <textarea
              id={`notes-${task.id}`}
              className="task-comments-editor"
              rows={4}
              value={draft}
              placeholder="Notes for this task — visible when you revisit this date."
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="task-comments-append">
              <input
                type="text"
                value={appendText}
                placeholder="Add a quick comment…"
                onChange={(e) => setAppendText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAppendComment();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-outline btn-pill btn-sm"
                disabled={busy || !appendText.trim()}
                onClick={onAppendComment}
              >
                Add
              </button>
              <button
                type="button"
                className="btn btn-primary btn-pill btn-sm"
                disabled={busy || !dirty}
                onClick={() =>
                  void runAction(async () => {
                    const notes = draft.trim() || null;
                    dispatch(
                      tasksActions.optimisticPatch({
                        taskId: task.id,
                        patch: { notes },
                      }),
                    );
                    await dispatch(
                      updateTaskOptimistic({
                        taskId: task.id,
                        date: task.date,
                        body: { notes },
                      }),
                    );
                  })
                }
              >
                {busy ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="priority-actions">
        <button
          className={`btn btn-ghost btn-pill btn-sm${commentsOpen ? ' is-active' : ''}`}
          type="button"
          title="Comments"
          aria-expanded={commentsOpen}
          onClick={() => setCommentsOpen((o) => !o)}
        >
          Notes
        </button>
        {task.meetLink && (
          <a
            className="btn btn-outline btn-pill btn-sm"
            href={task.meetLink}
            target="_blank"
            rel="noreferrer"
          >
            Join
          </a>
        )}
        {!locked && !done && (
          <button
            className="btn btn-ghost btn-pill btn-sm"
            type="button"
            disabled={busy}
            title="Move to backlog"
            onClick={() =>
              void runAction(async () => {
                dispatch(tasksActions.optimisticToBacklog({ taskId: task.id }));
                await dispatch(
                  moveToBacklogOptimistic({
                    taskId: task.id,
                    date: task.date,
                  }),
                );
              })
            }
          >
            Backlog
          </button>
        )}
        {running ? (
          <button
            className="btn btn-outline btn-pill btn-sm"
            type="button"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                dispatch(tasksActions.optimisticStop({ taskId: task.id }));
                await dispatch(
                  stopTimerOptimistic({ taskId: task.id, date: task.date }),
                );
              })
            }
          >
            {busy ? '…' : 'Pause'}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-pill btn-sm queue-start"
            type="button"
            disabled={done || busy}
            onClick={() =>
              void runAction(async () => {
                dispatch(tasksActions.optimisticStart({ taskId: task.id }));
                await dispatch(
                  startTimerOptimistic({ taskId: task.id, date: task.date }),
                );
              })
            }
          >
            {busy ? '…' : 'Start'}
          </button>
        )}
      </div>
    </div>
  );
}
