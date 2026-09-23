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
import { HintMark } from '../components/ui-hints';
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
    if (a.order !== b.order) return a.order - b.order;
    if (a.scheduledStart && b.scheduledStart) {
      return a.scheduledStart.localeCompare(b.scheduledStart);
    }
    if (a.scheduledStart) return -1;
    if (b.scheduledStart) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** After a queue reorder, shift unlocked task windows so times follow the new order immediately. */
function optimisticShiftSchedule(ordered: TaskDto[]): TaskDto[] {
  const movable = ordered.filter(
    (t) =>
      !t.scheduleLocked &&
      t.status !== 'completed' &&
      t.scheduledStart &&
      t.scheduledEnd,
  );
  if (movable.length < 2) return ordered;
  let cursor = Math.min(
    ...movable.map((t) => new Date(t.scheduledStart!).getTime()),
  );
  const nextTimes = new Map<string, { start: string; end: string }>();
  for (const t of movable) {
    const durMs = Math.max(
      5 * 60_000,
      new Date(t.scheduledEnd!).getTime() -
        new Date(t.scheduledStart!).getTime(),
    );
    const start = cursor;
    const end = start + durMs;
    nextTimes.set(t.id, {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    });
    cursor = end;
  }
  return ordered.map((t) => {
    const slot = nextTimes.get(t.id);
    return slot
      ? { ...t, scheduledStart: slot.start, scheduledEnd: slot.end }
      : t;
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

/** Free segments of [start, end) after removing busy intervals. */
function subtractBusy(
  start: number,
  end: number,
  busy: { start: number; end: number }[],
): { start: number; end: number }[] {
  let parts = [{ start, end }];
  for (const b of busy) {
    if (!(b.end > b.start)) continue;
    const next: { start: number; end: number }[] = [];
    for (const p of parts) {
      if (b.end <= p.start || b.start >= p.end) {
        next.push(p);
        continue;
      }
      if (p.start < b.start) next.push({ start: p.start, end: b.start });
      if (b.end < p.end) next.push({ start: b.end, end: p.end });
    }
    parts = next;
  }
  return parts.filter((p) => p.end > p.start);
}

/** Greedy lane assignment so overlapping blocks sit side-by-side. */
function assignLanes(
  items: { key: string; start: number; end: number }[],
): Map<string, { lane: number; laneCount: number }> {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    laneOf.set(item.key, lane);
  }
  // Per overlapping cluster, laneCount = max concurrent lanes used
  const result = new Map<string, { lane: number; laneCount: number }>();
  for (const item of sorted) {
    const lane = laneOf.get(item.key) ?? 0;
    let maxLane = lane;
    for (const other of sorted) {
      if (other.key === item.key) continue;
      if (other.start < item.end && other.end > item.start) {
        maxLane = Math.max(maxLane, laneOf.get(other.key) ?? 0);
      }
    }
    result.set(item.key, { lane, laneCount: maxLane + 1 });
  }
  return result;
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

  const busy: { start: number; end: number }[] = [];
  for (const t of opts.tasks) {
    if (t.status === 'completed') continue;
    if (!t.scheduledStart || !t.scheduledEnd) continue;
    const s = minutesOf(t.scheduledStart, opts.timeZone);
    const e = minutesOf(t.scheduledEnd, opts.timeZone);
    if (e > s) busy.push({ start: s, end: e });
  }
  for (const b of opts.breaks ?? []) {
    const s = parseHm(b.start);
    const e = parseHm(b.end);
    if (e > s) busy.push({ start: s, end: e });
  }
  busy.sort((a, b) => a.start - b.start);

  // Walk free gaps from cursor to midnight looking for a fit.
  const free = subtractBusy(cursor, 24 * 60, busy);
  for (const gap of free) {
    if (gap.end - gap.start >= duration) {
      const startMin = gap.start;
      const endMin = startMin + duration;
      return {
        scheduledStart: isoFromMinutes(opts.date, startMin),
        scheduledEnd: isoFromMinutes(opts.date, endMin),
      };
    }
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
  /** Day the new task is created on — defaults to the plan day being viewed */
  const [scheduleDate, setScheduleDate] = useState(date);
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
  const scheduleDayTasks = useAppSelector(
    (s) => s.tasks.byDate[scheduleDate] ?? EMPTY_TASKS,
  );
  const backlogTasks = useAppSelector((s) => s.tasks.backlog);
  const createPending = useAppSelector((s) =>
    s.tasks.pendingKeys.some((k) => k.startsWith('create:')),
  );
  const createErrorRedux = useAppSelector((s) => s.tasks.createError);

  // Keep "today" in sync when the civil day rolls over while viewing today
  useEffect(() => {
    if (isToday && date !== today) setDate(today);
  }, [today, isToday, date]);

  // Composer date follows the plan day unless the user is mid-edit (handled in onChange)
  useEffect(() => {
    setScheduleDate(date);
  }, [date]);

  // Prefetch the day we're scheduling onto (for optimistic packing)
  useEffect(() => {
    if (scheduleDate !== date) void dispatch(fetchTasks(scheduleDate));
  }, [dispatch, scheduleDate, date]);

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

  const pinnedStartForDate = (targetDate: string) => {
    if (targetDate === today) return defaultStart();
    const wd = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
    const tpl = scheduleQ.data?.find((t) => t.weekday === wd);
    const ws = tpl?.workStart?.trim();
    if (ws && /^\d{1,2}:\d{2}/.test(ws)) return ws.slice(0, 5);
    return '09:00';
  };

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
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)
      ? scheduleDate
      : date;
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
      const weekdayCheck = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
      const tmplCheck = scheduleQ.data?.find((t) => t.weekday === weekdayCheck);
      for (const b of tmplCheck?.breaks ?? []) {
        const bs = parseHm(b.start);
        const be = parseHm(b.end);
        if (be <= bs) continue;
        if (startMin < be && endMin > bs) {
          setFormError(
            `That slot overlaps ${b.name?.trim() || 'a break'} (${b.start}–${b.end}).`,
          );
          return;
        }
      }
      estimatedMinutes = mins;
      start = startTime;
      end = endTime;
    }

    const tid = tasksActions.tempId();
    const weekdayNow = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
    const dayTemplate = scheduleQ.data?.find((t) => t.weekday === weekdayNow);
    const packTasks =
      targetDate === date ? reduxTasks : scheduleDayTasks;
    const slot = nextOptimisticSlot({
      date: targetDate,
      durationMin: estimatedMinutes,
      tasks: packTasks,
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
        date: targetDate,
        name: trimmed,
        estimatedMinutes,
        scheduledStart: slot.scheduledStart,
        scheduledEnd: slot.scheduledEnd,
        scheduleLocked: Boolean(start && end),
      }),
    );
    const nextStart = pinnedStartForDate(targetDate);
    setStartTime(nextStart);
    setEndTime(defaultEnd(nextStart));
    nameInputRef.current?.focus();

    // Jump the plan to the day we just scheduled so the task is visible
    if (targetDate !== date) setDate(targetDate);

    void dispatch(
      createTaskOptimistic({
        date: targetDate,
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
        } else if (targetDate > today) {
          setCreateHint(`Scheduled on ${formatBacklogDay(targetDate, timeZone)}.`);
        }
        // Reconcile packing with server in the background (UI already updated)
        void dispatch(fetchTasks(targetDate));
        void dispatch(fetchBacklog());
        void qc.invalidateQueries({ queryKey: ['stats', targetDate] });
        void qc.invalidateQueries({ queryKey: ['eod', targetDate] });
        void qc.invalidateQueries({ queryKey: ['weekly'] });
        void qc.invalidateQueries({ queryKey: ['events', targetDate] });
        void dispatch(fetchStats(targetDate)).then((action) => {
          if (fetchStats.fulfilled.match(action)) {
            qc.setQueryData(['stats', targetDate], action.payload.stats);
          }
        });
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

  // Expand timeline to cover work hours and scheduled blocks.
  // Outside work hours, do NOT pull the viewport to midnight/late night —
  // that left an empty black plan with only the “now” line (tasks far below).
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
      // Only stretch for “now” when we’re near the workday
      if (now >= dayStartMin! - 60 && now <= dayEndMin! + 180) {
        bump(now);
        end = Math.max(end, now + 120);
      }
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

  // Scroll plan to the useful part of the day:
  // before work → work start; during work → near now; after work → late day.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || viewStartMin == null || !span) return;
    let targetMin = viewStartMin;
    if (isToday && dayStartMin != null && dayEndMin != null) {
      const now = nowMinutes(timeZone);
      if (now < dayStartMin) {
        targetMin = dayStartMin;
      } else if (now > dayEndMin + 30) {
        targetMin = Math.max(dayStartMin, dayEndMin - 90);
      } else {
        targetMin = Math.max(now - 30, viewStartMin);
      }
    }
    const top = Math.max(0, (targetMin - viewStartMin) * pxPerMin - 24);
    el.scrollTo({ top, behavior: 'smooth' });
  }, [
    date,
    viewStartMin,
    pxPerMin,
    span,
    isToday,
    timeZone,
    tasks.length,
    dayStartMin,
    dayEndMin,
  ]);

  const hourMarks = useMemo(() => {
    if (viewStartMin === null || viewEndMin === null) return [];
    const marks: number[] = [];
    const startH = Math.floor(viewStartMin / 60);
    const endH = Math.ceil(viewEndMin / 60);
    for (let h = startH; h <= endH; h++) marks.push(h * 60);
    return marks;
  }, [viewStartMin, viewEndMin]);

  const nowMin = nowMinutes(timeZone);
  // Hide the now line outside the workday so midnight doesn’t paint an empty plan
  const showNow =
    viewStartMin !== null &&
    viewEndMin !== null &&
    nowMin >= viewStartMin &&
    nowMin <= viewEndMin &&
    !(
      dayStartMin != null &&
      dayEndMin != null &&
      (nowMin < dayStartMin - 15 || nowMin > dayEndMin + 120)
    );

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

  /** Task blocks clipped around breaks, with lanes when times still collide. */
  const planTaskBlocks = useMemo(() => {
    const breakBusy = (template?.breaks ?? [])
      .map((b) => ({
        start: parseHm(b.start),
        end: parseHm(b.end),
      }))
      .filter((b) => b.end > b.start);

    type Block = {
      key: string;
      task: (typeof tasks)[number];
      start: number;
      end: number;
      rawS: number;
      rawE: number;
    };
    const blocks: Block[] = [];

    for (const t of tasks) {
      if (!t.scheduledStart || !t.scheduledEnd) continue;
      const rawS = minutesOf(t.scheduledStart, timeZone);
      const rawE = minutesOf(t.scheduledEnd, timeZone);
      if (!(rawE > rawS)) continue;
      const segments = t.scheduleLocked
        ? [{ start: rawS, end: rawE }]
        : subtractBusy(rawS, rawE, breakBusy);
      // Skip unlocked tasks that sit entirely inside a break — packing
      // will move them on the next schedule change; don't paint over Lunch.
      if (!segments.length) continue;
      segments.forEach((seg, i) => {
        blocks.push({
          key: `${t.id}-${i}`,
          task: t,
          start: seg.start,
          end: seg.end,
          rawS,
          rawE,
        });
      });
    }

    const lanes = assignLanes(
      blocks.map((b) => ({ key: b.key, start: b.start, end: b.end })),
    );
    return blocks.map((b) => ({
      ...b,
      lane: lanes.get(b.key)?.lane ?? 0,
      laneCount: lanes.get(b.key)?.laneCount ?? 1,
    }));
  }, [tasks, template?.breaks, timeZone]);

  // One-shot: if any unlocked task still overlaps a break (legacy bad pack),
  // nudge a reorder so the server re-packs without covering lunch.
  const overlapRepackKey = useRef<string | null>(null);
  useEffect(() => {
    const breaks = template?.breaks ?? [];
    if (!breaks.length || !tasks.length) return;
    const breakBusy = breaks
      .map((b) => ({ start: parseHm(b.start), end: parseHm(b.end) }))
      .filter((b) => b.end > b.start);
    const conflict = tasks.some((t) => {
      if (t.scheduleLocked || t.status === 'completed') return false;
      if (!t.scheduledStart || !t.scheduledEnd) return false;
      const s = minutesOf(t.scheduledStart, timeZone);
      const e = minutesOf(t.scheduledEnd, timeZone);
      return breakBusy.some((b) => s < b.end && e > b.start);
    });
    if (!conflict) return;
    const key = `${date}:${tasks.map((t) => t.id).join(',')}`;
    if (overlapRepackKey.current === key) return;
    overlapRepackKey.current = key;
    const unlockedIds = tasks.filter((t) => !t.scheduleLocked).map((t) => t.id);
    if (!unlockedIds.length) return;
    // Persist current order so the server re-packs times — do not refetch
    // and overwrite the Redux queue (fulfilled merges schedule fields).
    void dispatch(
      reorderTasksOptimistic({
        date,
        taskIds: tasks.map((t) => t.id),
        previous: tasks,
      }),
    );
  }, [tasks, template?.breaks, timeZone, date, dispatch]);

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
    const previous = tasks.map((t, i) => ({ ...t, order: i }));
    const next = optimisticShiftSchedule(
      arrayMove(tasks, oldIndex, newIndex).map((t, i) => ({
        ...t,
        order: i,
      })),
    );
    // UI follows Redux immediately — API only persists + refreshes times.
    dispatch(tasksActions.optimisticReorder({ date, tasks: next }));
    const taskIds = next.map((t) => t.id);
    void dispatch(
      reorderTasksOptimistic({
        date,
        taskIds,
        previous,
      }),
    ).then((result) => {
      if (reorderTasksOptimistic.fulfilled.match(result)) {
        invalidateStats();
      }
    });
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
              <h2 className="dash-col-title">
                The plan <HintMark id="dash.plan" placement="bottom" />
              </h2>
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

                    {(template?.breaks ?? [])
                      .slice()
                      .sort((a, b) => {
                        const ds = parseHm(a.start) - parseHm(b.start);
                        if (ds !== 0) return ds;
                        const aLunch = /lunch/i.test(a.name) ? 0 : 1;
                        const bLunch = /lunch/i.test(b.name) ? 0 : 1;
                        return aLunch - bLunch;
                      })
                      .filter((b, i, arr) => {
                        // Drop duplicate/overlapping break chips (e.g. Break + Lunch)
                        const s = parseHm(b.start);
                        const e = parseHm(b.end);
                        if (!(e > s)) return false;
                        return !arr.slice(0, i).some((prev) => {
                          const ps = parseHm(prev.start);
                          const pe = parseHm(prev.end);
                          return s < pe && e > ps;
                        });
                      })
                      .map((b) => {
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

                    {planTaskBlocks.map((block) => {
                      const t = block.task;
                      const s = Math.max(block.start, viewStartMin!);
                      const e = Math.min(block.end, viewEndMin!);
                      if (e <= s) return null;
                      const meet = Boolean(t.scheduleLocked || t.meetLink);
                      const isLive = Boolean(t.activeEntryId);
                      const done = t.status === 'completed';
                      const spanMin = Math.max(5, block.rawE - block.rawS);
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
                      const laneCount = Math.max(1, block.laneCount);
                      const lane = block.lane;
                      const widthPct = 100 / laneCount;
                      return (
                        <div
                          key={block.key}
                          className={`cal-block ${
                            meet ? 'busy meet' : 'task'
                          }${done ? ' is-done' : ''}${
                            isLive ? ' is-live' : ''
                          }`}
                          style={{
                            top: (s - viewStartMin!) * pxPerMin,
                            height: Math.max((e - s) * pxPerMin, 52),
                            left: `calc(${lane * widthPct}% + 4px)`,
                            width: `calc(${widthPct}% - 8px)`,
                            right: 'auto',
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
                            {formatHm(block.rawS)}
                            {meet ? '' : `–${formatHm(block.rawE)}`}
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
              <h2 className="dash-col-title">
                Queue <HintMark id="dash.queue" placement="bottom" />
              </h2>
              <p className="dash-col-sub">
                {statsQ.data?.today.pending ?? 0} pending ·{' '}
                {statsQ.data?.today.completed ?? 0} done
              </p>
            </div>
          </div>

          <form
            className={`add-task-composer${pinTime || scheduleDate !== date ? ' is-pinning' : ''}${scheduleDate !== today ? ' is-future' : ''}`}
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
            <label className="add-task-date-wrap" title="Schedule day">
              <input
                type="date"
                className="add-task-date"
                value={scheduleDate}
                onChange={(e) => {
                  const next = e.target.value || date;
                  setScheduleDate(next);
                  if (formError) setFormError(null);
                  if (createHint) setCreateHint(null);
                  if (pinTime) {
                    const s = pinnedStartForDate(next);
                    setStartTime(s);
                    setEndTime(defaultEnd(s));
                  }
                }}
                aria-label="Schedule date"
              />
            </label>
            <span className="add-task-dur" title="Default duration">
              {pinTime
                ? `${Math.max(5, parseHm(endTime) - parseHm(startTime))}m`
                : `${defaultTaskMinutes}m`}
            </span>
            <span className="add-task-pin-wrap">
              <button
                type="button"
                className={`add-task-pin-btn${pinTime ? ' is-on' : ''}`}
                aria-pressed={pinTime}
                aria-label="Pin time"
                onClick={() => {
                  setPinTime((v) => {
                    const next = !v;
                    if (next) {
                      const s = pinnedStartForDate(scheduleDate);
                      setStartTime(s);
                      setEndTime(defaultEnd(s));
                    }
                    return next;
                  });
                }}
              >
                Pin
              </button>
              <HintMark id="dash.pin" placement="bottom" />
            </span>
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
              {createPending ? 'Adding' : scheduleDate > today ? 'Schedule' : 'Add'}
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
  const isFutureDay = task.date > todayISO(timeZone);

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
            disabled={busy || task.status === 'completed' || isFutureDay}
            title={isFutureDay ? 'Timer unlocks on that day' : undefined}
            onClick={() => {
              if (isFutureDay) return;
              void run(async () => {
                dispatch(tasksActions.optimisticStart({ taskId: task.id }));
                await dispatch(
                  startTimerOptimistic({ taskId: task.id, date: task.date }),
                );
              });
            }}
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
            Backlog <HintMark id="dash.backlog" placement="top" />
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
  const today = todayISO(timeZone);
  const isFutureDay = task.date > today;
  const canStartTimer = !done && !isFutureDay;
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
            disabled={!canStartTimer || busy}
            title={
              isFutureDay
                ? 'Timer unlocks on that day'
                : done
                  ? 'Already done'
                  : 'Start timer'
            }
            onClick={() => {
              if (!canStartTimer) return;
              void runAction(async () => {
                dispatch(tasksActions.optimisticStart({ taskId: task.id }));
                await dispatch(
                  startTimerOptimistic({ taskId: task.id, date: task.date }),
                );
              });
            }}
          >
            {busy ? '…' : 'Start'}
          </button>
        )}
      </div>
    </div>
  );
}
