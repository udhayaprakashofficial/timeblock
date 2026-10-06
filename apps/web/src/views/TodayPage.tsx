'use client';

import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
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
import { HintMark, UiTooltip } from '../components/ui-hints';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  createTaskOptimistic,
  fetchBacklog,
  fetchTasks,
  moveToBacklogOptimistic,
  queueCompleteTask,
  removeTaskOptimistic,
  reorderTasksOptimistic,
  scheduleFromBacklogOptimistic,
  selectTasksLoading,
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
/** 30m block ≈ 66px so title + time fit without overlapping the next slot */
const MIN_PX_PER_MIN = 2.2;
const MAX_PX_PER_MIN = 3.2;

function parseHm(hm: string) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function formatHm(total: number) {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** e.g. 600 → "10h", 130 → "2h 10m", 45 → "45m" */
function formatDurationLabel(minutes: number): string {
  const mins = Math.max(0, Math.round(minutes));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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

/** After a queue reorder, re-pack unlocked tasks into free slots (skips breaks). */
function optimisticRepackSchedule(
  ordered: TaskDto[],
  opts: {
    date: string;
    timeZone?: string | null;
    workStart?: string;
    workEnd?: string;
    breaks?: { start: string; end: string }[];
  },
): TaskDto[] {
  const dayStart = opts.workStart ? parseHm(opts.workStart) : 0;
  const dayEnd = opts.workEnd ? parseHm(opts.workEnd) : 24 * 60;
  if (!(dayEnd > dayStart)) return ordered;

  const fixedBusy: { start: number; end: number }[] = [];
  for (const b of opts.breaks ?? []) {
    const s = parseHm(b.start);
    const e = parseHm(b.end);
    if (e > s) fixedBusy.push({ start: s, end: e });
  }
  for (const t of ordered) {
    // Meetings, completed, and live timers keep their slot — never move a running task.
    if (
      !(
        t.scheduleLocked ||
        t.status === 'completed' ||
        Boolean(t.activeEntryId)
      )
    ) {
      continue;
    }
    if (!t.scheduledStart || !t.scheduledEnd) continue;
    const s = minutesOf(t.scheduledStart, opts.timeZone);
    const e = minutesOf(t.scheduledEnd, opts.timeZone);
    if (e > s) fixedBusy.push({ start: s, end: e });
  }

  // Pack unlocked tasks into free gaps; if the workday is full, stack them
  // sequentially past workEnd (overtime) so nothing shares a start time.
  let free = subtractBusy(dayStart, dayEnd, fixedBusy);
  const nextTimes = new Map<string, { start: string; end: string }>();
  let overtimeCursor = Math.max(
    dayEnd,
    ...fixedBusy.map((b) => b.end),
    0,
  );

  for (const t of ordered) {
    if (
      t.scheduleLocked ||
      t.status === 'completed' ||
      Boolean(t.activeEntryId)
    ) {
      continue;
    }
    const duration = Math.max(5, t.estimatedMinutes || 30);
    let placed: { start: number; end: number } | null = null;
    for (const gap of free) {
      if (gap.end - gap.start >= duration) {
        placed = { start: gap.start, end: gap.start + duration };
        break;
      }
    }
    if (!placed) {
      const start = Math.min(overtimeCursor, 24 * 60 - duration);
      placed = { start, end: start + duration };
      overtimeCursor = placed.end;
    } else if (placed.end > dayEnd) {
      overtimeCursor = Math.max(overtimeCursor, placed.end);
    }
    nextTimes.set(t.id, {
      start: isoFromMinutes(opts.date, placed.start),
      end: isoFromMinutes(opts.date, placed.end),
    });
    free = free.flatMap((gap) => {
      if (placed!.end <= gap.start || placed!.start >= gap.end) return [gap];
      const parts: { start: number; end: number }[] = [];
      if (gap.start < placed!.start) {
        parts.push({ start: gap.start, end: placed!.start });
      }
      if (placed!.end < gap.end) {
        parts.push({ start: placed!.end, end: gap.end });
      }
      return parts;
    });
    if (placed.end <= dayEnd) {
      overtimeCursor = Math.max(overtimeCursor, placed.end);
    }
  }

  return ordered.map((t) => {
    const slot = nextTimes.get(t.id);
    return slot
      ? { ...t, scheduledStart: slot.start, scheduledEnd: slot.end }
      : t;
  });
}

/**
 * Queue time labels: prefer real schedule fields; fill gaps with a
 * non-overlapping pack. Overlaps are fixed in Redux by the plan packer.
 */
function resolveDisplaySchedule(
  ordered: TaskDto[],
  opts: {
    date: string;
    timeZone?: string | null;
    workStart?: string;
    workEnd?: string;
    breaks?: { start: string; end: string }[];
  },
): Map<string, { start: string; end: string }> {
  const packed = optimisticRepackSchedule(ordered, opts);
  const packedById = new Map(
    packed
      .filter((t) => t.scheduledStart && t.scheduledEnd)
      .map((t) => [
        t.id,
        { start: t.scheduledStart!, end: t.scheduledEnd! },
      ]),
  );

  // Detect unlocked overlaps in the stored schedule.
  const unlocked = ordered.filter(
    (t) =>
      !t.scheduleLocked &&
      t.status !== 'completed' &&
      !t.activeEntryId &&
      t.scheduledStart &&
      t.scheduledEnd,
  );
  let hasOverlap = false;
  for (let i = 0; i < unlocked.length && !hasOverlap; i++) {
    const a = unlocked[i]!;
    const as = minutesOf(a.scheduledStart!, opts.timeZone);
    const ae = minutesOf(a.scheduledEnd!, opts.timeZone);
    for (let j = i + 1; j < unlocked.length; j++) {
      const b = unlocked[j]!;
      const bs = minutesOf(b.scheduledStart!, opts.timeZone);
      const be = minutesOf(b.scheduledEnd!, opts.timeZone);
      if (as < be && ae > bs) {
        hasOverlap = true;
        break;
      }
    }
  }

  const out = new Map<string, { start: string; end: string }>();
  for (const t of ordered) {
    if (hasOverlap) {
      const slot = packedById.get(t.id);
      if (slot) out.set(t.id, slot);
      continue;
    }
    if (t.scheduledStart && t.scheduledEnd) {
      out.set(t.id, { start: t.scheduledStart, end: t.scheduledEnd });
    } else {
      const slot = packedById.get(t.id);
      if (slot) out.set(t.id, slot);
    }
  }
  return out;
}

function NotesIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

function ParkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 8v13H3V8" />
      <path d="M23 3H1v5h22z" />
      <path d="M10 12h4" />
    </svg>
  );
}

const DURATION_MIN = 5;
const DURATION_MAX = 999; // 3 digits
const DURATION_STEP = 5;

function parseDurationInput(raw: string, fallback: number): number {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 3);
  if (!digits) return Math.max(DURATION_MIN, Math.min(DURATION_MAX, fallback));
  const n = Number(digits);
  if (!Number.isFinite(n)) {
    return Math.max(DURATION_MIN, Math.min(DURATION_MAX, fallback));
  }
  return Math.max(DURATION_MIN, Math.min(DURATION_MAX, Math.round(n)));
}

/** Keep only digit characters, max 3 (empty allowed while editing). */
function digitsOnly(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 3);
}

function nudgeDuration(raw: string, delta: number, fallback: number): string {
  const current = parseDurationInput(raw, fallback);
  return String(
    Math.max(DURATION_MIN, Math.min(DURATION_MAX, current + delta)),
  );
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

/** Read-only wall-clock range from minute-of-day (updates live while dragging). */
function formatScheduleRangeFromMinutes(
  date: string,
  startMin: number,
  endMin: number,
  timeZone?: string | null,
): string {
  return formatTimeRange(
    isoFromMinutes(date, startMin),
    isoFromMinutes(date, endMin),
    timeZone,
  );
}

/** Seconds of the open session from timerStartedAt (survives refresh). */
function liveSessionSeconds(
  timerStartedAt: string | null | undefined,
  nowMs = Date.now(),
): number {
  if (!timerStartedAt) return 0;
  const started = Date.parse(timerStartedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((nowMs - started) / 1000));
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
  workStart?: string;
  workEnd?: string;
  /** Allow placing past workEnd (overtime). */
  allowOvertime?: boolean;
}): { scheduledStart: string; scheduledEnd: string } | null {
  if (opts.pinStart && opts.pinEnd) {
    return {
      scheduledStart: combineIso(opts.date, opts.pinStart),
      scheduledEnd: combineIso(opts.date, opts.pinEnd),
    };
  }
  // Working hours come from the user's schedule template — never invent defaults.
  if (!opts.workStart || !opts.workEnd) return null;

  const duration = Math.max(5, opts.durationMin);
  const today = todayISO(opts.timeZone);
  const dayStart = parseHm(opts.workStart);
  const dayEnd = parseHm(opts.workEnd);
  if (!(dayEnd > dayStart)) return null;
  let cursor =
    opts.date === today
      ? Math.max(dayStart, Math.ceil((nowMinutes(opts.timeZone) + 1) / 5) * 5)
      : dayStart;

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

  const searchEnd = opts.allowOvertime
    ? Math.min(24 * 60, dayEnd + Math.max(duration, 4 * 60))
    : dayEnd;
  const free = subtractBusy(cursor, searchEnd, busy);
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
  return null;
}

/** Free minutes inside the user's work hours (after now for today). */
function availableWorkMinutes(opts: {
  date: string;
  tasks: TaskDto[];
  timeZone?: string | null;
  breaks?: { start: string; end: string }[];
  workStart?: string;
  workEnd?: string;
}): number {
  if (!opts.workStart || !opts.workEnd) return 0;
  const dayStart = parseHm(opts.workStart);
  const dayEnd = parseHm(opts.workEnd);
  if (!(dayEnd > dayStart)) return 0;
  const today = todayISO(opts.timeZone);
  const cursor =
    opts.date === today
      ? Math.max(dayStart, Math.ceil((nowMinutes(opts.timeZone) + 1) / 5) * 5)
      : dayStart;
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
  return subtractBusy(cursor, dayEnd, busy).reduce(
    (sum, g) => sum + (g.end - g.start),
    0,
  );
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
  /** Day the new task is created on — defaults to the plan day being viewed */
  const [scheduleDate, setScheduleDate] = useState(date);
  const [durationDraft, setDurationDraft] = useState(String(defaultTaskMinutes));
  const [formError, setFormError] = useState<string | null>(null);
  const [createHint, setCreateHint] = useState<string | null>(null);
  const [overflowPrompt, setOverflowPrompt] = useState<{
    name: string;
    estimatedMinutes: number;
    targetDate: string;
    freeMinutes: number;
    workStart: string;
    workEnd: string;
  } | null>(null);
  const [overflowMovingNext, setOverflowMovingNext] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const reduxTasks = useAppSelector((s) => {
    const list = s.tasks.byDate[date];
    return Array.isArray(list) ? list : EMPTY_TASKS;
  });
  const scheduleDayTasks = useAppSelector((s) => {
    const list = s.tasks.byDate[scheduleDate];
    return Array.isArray(list) ? list : EMPTY_TASKS;
  });
  const backlogTasks = useAppSelector((s) =>
    Array.isArray(s.tasks.backlog) ? s.tasks.backlog : EMPTY_TASKS,
  );
  const createErrorRedux = useAppSelector((s) => s.tasks.createError);
  const dayLoaded = useAppSelector((s) => Boolean(s.tasks.loadedDates[date]));
  const tasksLoading = useAppSelector(selectTasksLoading(date));
  const queueLoading = !dayLoaded || tasksLoading;

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

  const commitNewTask = (opts: {
    targetDate: string;
    name: string;
    estimatedMinutes: number;
    overflowMode?: 'overtime' | 'reprioritize';
    allowOvertimeSlot?: boolean;
  }) => {
    const { targetDate, name: trimmed, estimatedMinutes } = opts;
    const weekdayNow = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
    const dayTemplate = scheduleQ.data?.find((t) => t.weekday === weekdayNow);
    const packTasks =
      targetDate === date ? reduxTasks : scheduleDayTasks;
    const slot = nextOptimisticSlot({
      date: targetDate,
      durationMin: estimatedMinutes,
      tasks: packTasks,
      timeZone,
      workStart: dayTemplate?.workStart,
      workEnd: dayTemplate?.workEnd,
      breaks: dayTemplate?.breaks?.map((b) => ({
        start: b.start,
        end: b.end,
      })),
      allowOvertime: Boolean(
        opts.allowOvertimeSlot || opts.overflowMode === 'overtime',
      ),
    });

    const tid = tasksActions.tempId();
    setFormError(null);
    setCreateHint(null);
    setOverflowPrompt(null);
    setName('');
    dispatch(tasksActions.clearCreateError());
    dispatch(
      tasksActions.optimisticCreate({
        tempId: tid,
        date: targetDate,
        name: trimmed,
        estimatedMinutes,
        scheduledStart: slot?.scheduledStart ?? null,
        scheduledEnd: slot?.scheduledEnd ?? null,
        scheduleLocked: false,
      }),
    );
    nameInputRef.current?.focus();

    if (targetDate !== date) setDate(targetDate);

    const startTime =
      slot?.scheduledStart != null
        ? formatHm(minutesOf(slot.scheduledStart, timeZone))
        : undefined;
    const endTime =
      slot?.scheduledEnd != null
        ? formatHm(minutesOf(slot.scheduledEnd, timeZone))
        : undefined;

    void dispatch(
      createTaskOptimistic({
        date: targetDate,
        name: trimmed,
        estimatedMinutes,
        tempId: tid,
        overflowMode: opts.overflowMode,
        ...(startTime && endTime ? { startTime, endTime } : {}),
      }),
    ).then((result) => {
      if (createTaskOptimistic.fulfilled.match(result)) {
        const task = result.payload.task;
        if (task.inBacklog) {
          setCreateHint(`Moved to Backlog — no free slot for ${task.name}.`);
        } else if (opts.overflowMode === 'overtime') {
          setCreateHint(`${task.name} added as overtime.`);
        } else if (opts.overflowMode === 'reprioritize') {
          setCreateHint(`${task.name} scheduled — plan reshuffled.`);
        } else if (targetDate > today) {
          setCreateHint(
            `Scheduled on ${formatBacklogDay(targetDate, timeZone)}.`,
          );
        }
        // Optimistic state already matches — only refresh stats in background.
        void qc.invalidateQueries({ queryKey: ['stats', targetDate] });
        void qc.invalidateQueries({ queryKey: ['eod', targetDate] });
        void qc.invalidateQueries({ queryKey: ['weekly'] });
        void dispatch(fetchStats(targetDate)).then((action) => {
          if (fetchStats.fulfilled.match(action)) {
            qc.setQueryData(['stats', targetDate], action.payload.stats);
          }
        });
      }
    });
  };

  const findNextWorkingDay = async (
    fromDate: string,
    estimatedMinutes: number,
  ): Promise<string | null> => {
    const templates = scheduleQ.data ?? [];
    for (let i = 1; i <= 14; i++) {
      const d = shiftDateISO(fromDate, i);
      const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
      const dayTemplate = templates.find((t) => t.weekday === weekday);
      if (!dayTemplate?.workStart || !dayTemplate?.workEnd) continue;
      let dayTasks: TaskDto[] = [];
      try {
        dayTasks = await api.get<TaskDto[]>(`/api/tasks?date=${d}`);
      } catch {
        dayTasks = [];
      }
      const free = availableWorkMinutes({
        date: d,
        tasks: dayTasks,
        timeZone,
        workStart: dayTemplate.workStart,
        workEnd: dayTemplate.workEnd,
        breaks: dayTemplate.breaks?.map((b) => ({
          start: b.start,
          end: b.end,
        })),
      });
      if (free >= estimatedMinutes) return d;
    }
    return null;
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
    const estimatedMinutes = parseDurationInput(
      durationDraft,
      defaultTaskMinutes,
    );
    if (estimatedMinutes < 5) {
      setFormError('Duration must be at least 5 minutes.');
      return;
    }

    const weekdayNow = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
    const dayTemplate = scheduleQ.data?.find((t) => t.weekday === weekdayNow);
    if (!dayTemplate?.workStart || !dayTemplate?.workEnd) {
      setFormError(
        'Set your working hours in Settings before scheduling tasks.',
      );
      return;
    }

    const packTasks =
      targetDate === date ? reduxTasks : scheduleDayTasks;
    const freeMinutes = availableWorkMinutes({
      date: targetDate,
      tasks: packTasks,
      timeZone,
      workStart: dayTemplate.workStart,
      workEnd: dayTemplate.workEnd,
      breaks: dayTemplate.breaks?.map((b) => ({
        start: b.start,
        end: b.end,
      })),
    });
    const slot = nextOptimisticSlot({
      date: targetDate,
      durationMin: estimatedMinutes,
      tasks: packTasks,
      timeZone,
      workStart: dayTemplate.workStart,
      workEnd: dayTemplate.workEnd,
      breaks: dayTemplate.breaks?.map((b) => ({
        start: b.start,
        end: b.end,
      })),
    });

    if (!slot || freeMinutes < estimatedMinutes) {
      setOverflowPrompt({
        name: trimmed,
        estimatedMinutes,
        targetDate,
        freeMinutes,
        workStart: dayTemplate.workStart,
        workEnd: dayTemplate.workEnd,
      });
      return;
    }

    commitNewTask({ targetDate, name: trimmed, estimatedMinutes });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const tasks = useMemo(() => sortDay(reduxTasks), [reduxTasks]);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const template = scheduleQ.data?.find((t) => t.weekday === weekday);

  const scheduleLabels = useMemo(() => {
    const slots = resolveDisplaySchedule(tasks, {
      date,
      timeZone,
      workStart: template?.workStart,
      workEnd: template?.workEnd,
      breaks: template?.breaks?.map((b) => ({
        start: b.start,
        end: b.end,
      })),
    });
    const labels = new Map<string, string>();
    for (const t of tasks) {
      const slot = slots.get(t.id);
      if (!slot) continue;
      labels.set(
        t.id,
        formatTimeRange(slot.start, slot.end, timeZone),
      );
    }
    return labels;
  }, [tasks, date, timeZone, template?.workStart, template?.workEnd, template?.breaks]);

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
  const scrollPlanIntoViewRef = useRef(() => {});
  scrollPlanIntoViewRef.current = () => {
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
    el.closest('.schedule-board')?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  };

  useEffect(() => {
    scrollPlanIntoViewRef.current();
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

  useEffect(() => {
    const onViewSchedule = () => scrollPlanIntoViewRef.current();
    window.addEventListener('tb:view-schedule', onViewSchedule);
    return () => window.removeEventListener('tb:view-schedule', onViewSchedule);
  }, []);

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

  // One-shot: if unlocked tasks overlap each other or a break, pack locally
  // (including overtime stack) then persist — never leave side-by-side cards.
  const overlapRepackKey = useRef<string | null>(null);
  useEffect(() => {
    if (!tasks.length) return;
    if (!template?.workStart || !template?.workEnd) return;
    const breakBusy = (template?.breaks ?? [])
      .map((b) => ({ start: parseHm(b.start), end: parseHm(b.end) }))
      .filter((b) => b.end > b.start);
    const placed = tasks
      .filter(
        (t) =>
          !t.scheduleLocked &&
          t.status !== 'completed' &&
          !t.activeEntryId &&
          t.scheduledStart &&
          t.scheduledEnd,
      )
      .map((t) => ({
        id: t.id,
        start: minutesOf(t.scheduledStart!, timeZone),
        end: minutesOf(t.scheduledEnd!, timeZone),
      }))
      .filter((t) => t.end > t.start);
    let conflict = false;
    for (let i = 0; i < placed.length && !conflict; i++) {
      const a = placed[i]!;
      if (breakBusy.some((b) => a.start < b.end && a.end > b.start)) {
        conflict = true;
        break;
      }
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]!;
        if (a.start < b.end && a.end > b.start) {
          conflict = true;
          break;
        }
      }
    }
    // Also treat identical start times as conflict even if durations differ.
    if (!conflict) {
      const starts = new Set<number>();
      for (const p of placed) {
        if (starts.has(p.start)) {
          conflict = true;
          break;
        }
        starts.add(p.start);
      }
    }
    if (!conflict) return;
    const key = `${date}:${placed.map((t) => `${t.id}:${t.start}-${t.end}`).join('|')}`;
    if (overlapRepackKey.current === key) return;
    overlapRepackKey.current = key;
    const packed = optimisticRepackSchedule(tasks, {
      date,
      timeZone,
      workStart: template.workStart,
      workEnd: template.workEnd,
      breaks: template.breaks?.map((b) => ({
        start: b.start,
        end: b.end,
      })),
    });
    dispatch(tasksActions.optimisticReorder({ date, tasks: packed }));
    void dispatch(
      reorderTasksOptimistic({
        date,
        taskIds: packed.map((t) => t.id),
        previous: tasks,
      }),
    );
  }, [tasks, template?.breaks, template?.workStart, template?.workEnd, timeZone, date, dispatch]);

  const timelineH = span * pxPerMin;
  const planDragRef = useRef<{
    taskId: string;
    duration: number;
    originY: number;
    originStart: number;
    originScrollTop: number;
    lastClientY: number;
  } | null>(null);
  const planDragRafRef = useRef<number | null>(null);
  const [planDragPreview, setPlanDragPreview] = useState<{
    taskId: string;
    startMin: number;
    valid: boolean;
  } | null>(null);
  const [planDragError, setPlanDragError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (planDragRafRef.current != null) {
        cancelAnimationFrame(planDragRafRef.current);
        planDragRafRef.current = null;
      }
      document.body.classList.remove('is-plan-dragging');
    },
    [],
  );

  const canPlaceAt = (taskId: string, startMin: number, duration: number) => {
    const endMin = startMin + duration;
    if (dayStartMin == null || dayEndMin == null) return false;
    if (startMin < dayStartMin || endMin > dayEndMin) return false;
    for (const b of template?.breaks ?? []) {
      const bs = parseHm(b.start);
      const be = parseHm(b.end);
      if (be > bs && startMin < be && endMin > bs) return false;
    }
    for (const t of tasks) {
      if (t.id === taskId || t.status === 'completed') continue;
      if (!t.scheduledStart || !t.scheduledEnd) continue;
      // Live timers are fixed on the plan — don't allow drops over them.
      const os = minutesOf(t.scheduledStart, timeZone);
      const oe = minutesOf(t.scheduledEnd, timeZone);
      if (startMin < oe && endMin > os) return false;
    }
    return true;
  };

  /**
   * 5-min snap often misses irregular gaps (e.g. 15:24–15:54). Search 1-min
   * steps around the desired start so a task that fits can still land.
   */
  const findNearestValidStart = (
    taskId: string,
    desired: number,
    duration: number,
    searchRadius: number,
  ): number | null => {
    if (dayStartMin == null || dayEndMin == null) return null;
    const maxStart = dayEndMin - duration;
    if (maxStart < dayStartMin) return null;
    const clamped = Math.max(dayStartMin, Math.min(desired, maxStart));
    if (canPlaceAt(taskId, clamped, duration)) return clamped;
    for (let d = 1; d <= searchRadius; d++) {
      const lo = clamped - d;
      if (lo >= dayStartMin && canPlaceAt(taskId, lo, duration)) return lo;
      const hi = clamped + d;
      if (hi <= maxStart && canPlaceAt(taskId, hi, duration)) return hi;
    }
    return null;
  };

  const resolvePlanDragStart = (
    taskId: string,
    desired: number,
    duration: number,
    forDrop: boolean,
  ): { startMin: number; valid: boolean } => {
    const snapped = Math.round(desired / 5) * 5;
    if (canPlaceAt(taskId, snapped, duration)) {
      return { startMin: snapped, valid: true };
    }
    // Preview: pull into nearby gaps (half-duration covers mid-gap aim);
    // drop: wider search so exact fits still win after a slightly off release.
    const radius = forDrop
      ? Math.max(90, duration)
      : Math.max(28, Math.floor(duration / 2) + 8);
    const nearest = findNearestValidStart(taskId, desired, duration, radius);
    if (nearest != null) return { startMin: nearest, valid: true };
    // Mid-gap aim often snaps to :00/:05 and misses :24 boundaries — retry from snap.
    const fromSnap = findNearestValidStart(taskId, snapped, duration, radius);
    if (fromSnap != null) return { startMin: fromSnap, valid: true };
    return { startMin: snapped, valid: false };
  };

  const stopPlanDragScrollLoop = () => {
    if (planDragRafRef.current != null) {
      cancelAnimationFrame(planDragRafRef.current);
      planDragRafRef.current = null;
    }
  };

  const updatePlanDragFromPointer = (clientY: number) => {
    const drag = planDragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || viewStartMin == null) return;

    const rect = viewport.getBoundingClientRect();
    const edge = 64;
    let scrollDelta = 0;
    if (clientY < rect.top + edge) {
      const t = 1 - Math.max(0, clientY - rect.top) / edge;
      scrollDelta = -Math.ceil(6 + t * 18);
    } else if (clientY > rect.bottom - edge) {
      const t = 1 - Math.max(0, rect.bottom - clientY) / edge;
      scrollDelta = Math.ceil(6 + t * 18);
    }
    if (scrollDelta !== 0) {
      viewport.scrollTop = Math.max(
        0,
        Math.min(
          viewport.scrollHeight - viewport.clientHeight,
          viewport.scrollTop + scrollDelta,
        ),
      );
    }

    const scrollComp =
      viewport.scrollTop - drag.originScrollTop;
    const deltaMin = Math.round(
      (clientY - drag.originY + scrollComp) / pxPerMin,
    );
    const raw = drag.originStart + deltaMin;
    const resolved = resolvePlanDragStart(
      drag.taskId,
      raw,
      drag.duration,
      false,
    );
    setPlanDragPreview({
      taskId: drag.taskId,
      startMin: resolved.startMin,
      valid: resolved.valid,
    });
  };

  const ensurePlanDragScrollLoop = () => {
    if (planDragRafRef.current != null) return;
    const tick = () => {
      const drag = planDragRef.current;
      if (!drag) {
        planDragRafRef.current = null;
        return;
      }
      updatePlanDragFromPointer(drag.lastClientY);
      planDragRafRef.current = requestAnimationFrame(tick);
    };
    planDragRafRef.current = requestAnimationFrame(tick);
  };

  const endPlanDrag = () => {
    stopPlanDragScrollLoop();
    document.body.classList.remove('is-plan-dragging');
    planDragRef.current = null;
  };

  const onPlanBlockPointerDown = (
    e: PointerEvent<HTMLDivElement>,
    task: TaskDto,
    startMin: number,
  ) => {
    if (task.scheduleLocked || task.status === 'completed' || task.activeEntryId)
      return;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const scrollTop = viewportRef.current?.scrollTop ?? 0;
    planDragRef.current = {
      taskId: task.id,
      duration: Math.max(5, task.estimatedMinutes),
      originY: e.clientY,
      originStart: startMin,
      originScrollTop: scrollTop,
      lastClientY: e.clientY,
    };
    document.body.classList.add('is-plan-dragging');
    setPlanDragPreview({ taskId: task.id, startMin, valid: true });
    setPlanDragError(null);
  };

  const onPlanBlockPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = planDragRef.current;
    if (!drag || viewStartMin == null) return;
    drag.lastClientY = e.clientY;
    updatePlanDragFromPointer(e.clientY);
    const viewport = viewportRef.current;
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      const nearEdge =
        e.clientY < rect.top + 64 || e.clientY > rect.bottom - 64;
      if (nearEdge) ensurePlanDragScrollLoop();
      else stopPlanDragScrollLoop();
    }
  };

  const onPlanBlockPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const drag = planDragRef.current;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!drag) {
      endPlanDrag();
      setPlanDragPreview(null);
      return;
    }

    // Final resolve from pointer (includes scroll) so drop matches what user aimed for.
    const viewport = viewportRef.current;
    const scrollComp = viewport
      ? viewport.scrollTop - drag.originScrollTop
      : 0;
    const deltaMin = Math.round(
      (e.clientY - drag.originY + scrollComp) / pxPerMin,
    );
    const raw = drag.originStart + deltaMin;
    const resolved = resolvePlanDragStart(
      drag.taskId,
      raw,
      drag.duration,
      true,
    );
    const startMin = resolved.startMin;
    const endMin = startMin + drag.duration;
    endPlanDrag();
    setPlanDragPreview(null);
    if (startMin === drag.originStart) return;
    if (!resolved.valid || !canPlaceAt(drag.taskId, startMin, drag.duration)) {
      setPlanDragError(
        'That drop overlaps another task or sits outside work hours.',
      );
      return;
    }
    const startHm = formatHm(startMin);
    const endHm = formatHm(endMin);
    dispatch(
      tasksActions.optimisticPatch({
        taskId: drag.taskId,
        patch: {
          scheduledStart: isoFromMinutes(date, startMin),
          scheduledEnd: isoFromMinutes(date, endMin),
          estimatedMinutes: drag.duration,
          scheduleLocked: false,
        },
      }),
    );
    void dispatch(
      updateTaskOptimistic({
        taskId: drag.taskId,
        date,
        body: { startTime: startHm, endTime: endHm },
      }),
    ).then((result) => {
      if (updateTaskOptimistic.rejected.match(result)) {
        setPlanDragError(
          (result.payload as { message?: string })?.message ||
            'Could not move task — slot may be taken.',
        );
        void dispatch(fetchTasks(date));
      } else {
        invalidateStats();
      }
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    if (
      tasks[oldIndex]?.scheduleLocked ||
      tasks[newIndex]?.scheduleLocked ||
      tasks[oldIndex]?.activeEntryId ||
      tasks[newIndex]?.activeEntryId
    ) {
      return;
    }
    const previous = tasks.map((t, i) => ({ ...t, order: i }));
    const next = optimisticRepackSchedule(
      arrayMove(tasks, oldIndex, newIndex).map((t, i) => ({
        ...t,
        order: i,
      })),
      {
        date,
        timeZone,
        workStart: template?.workStart,
        workEnd: template?.workEnd,
        breaks: template?.breaks,
      },
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
  // Finished tasks with logged time (timer or checkbox Done) — not open queue items
  const loggedSessions = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'completed' && t.actualMinutes > 0)
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

  const formatDur = (mins: number) => formatDurationLabel(mins);

  return (
    <div className="today-page dash-page">
      {heroTask && (
        <SessionBanner
          task={heroTask.task}
          mode={heroTask.mode}
          timeZone={timeZone}
          onChanged={invalidateStats}
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
            {scheduleQ.isLoading && !hasSchedule ? (
              <div className="priority-empty">Loading your plan…</div>
            ) : !hasSchedule ? (
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
                    {dayStartMin != null &&
                      dayEndMin != null &&
                      viewStartMin != null && (
                        <>
                          <div
                            className="day-work-band"
                            style={{
                              top: (dayStartMin - viewStartMin) * pxPerMin,
                              height: Math.max(
                                0,
                                (dayEndMin - dayStartMin) * pxPerMin,
                              ),
                            }}
                            aria-hidden
                          />
                          {viewEndMin != null && viewEndMin > dayEndMin ? (
                            <div
                              className="day-overtime-band"
                              style={{
                                top: (dayEndMin - viewStartMin) * pxPerMin,
                                height: Math.max(
                                  0,
                                  (viewEndMin - dayEndMin) * pxPerMin,
                                ),
                              }}
                              aria-hidden
                            />
                          ) : null}
                        </>
                      )}

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
                      const dragStart =
                        planDragPreview?.taskId === t.id
                          ? planDragPreview.startMin
                          : s;
                      const slotH = Math.max((e - s) * pxPerMin, 18);
                      const dragHeight =
                        planDragPreview?.taskId === t.id
                          ? Math.max(
                              Math.max(5, t.estimatedMinutes) * pxPerMin,
                              18,
                            )
                          : slotH;
                      const compact = dragHeight < 70;
                      const rangeStartMin =
                        planDragPreview?.taskId === t.id
                          ? planDragPreview.startMin
                          : block.rawS;
                      const rangeEndMin =
                        planDragPreview?.taskId === t.id
                          ? planDragPreview.startMin +
                            Math.max(5, t.estimatedMinutes)
                          : block.rawE;
                      const scheduleRange = formatScheduleRangeFromMinutes(
                        date,
                        rangeStartMin,
                        rangeEndMin,
                        timeZone,
                      );
                      const isOvertime =
                        !meet &&
                        dayEndMin != null &&
                        block.start >= dayEndMin;
                      const crossesOvertime =
                        !meet &&
                        dayEndMin != null &&
                        block.start < dayEndMin &&
                        block.end > dayEndMin;
                      return (
                        <div
                          key={block.key}
                          className={`cal-block ${
                            meet ? 'busy meet' : 'task'
                          }${done ? ' is-done' : ''}${
                            isLive ? ' is-live' : ''
                          }${
                            !meet && !done && !isLive ? ' is-draggable' : ''
                          }${
                            planDragPreview?.taskId === t.id
                              ? ` is-dragging-plan${
                                  planDragPreview.valid
                                    ? ' is-drop-valid'
                                    : ' is-drop-invalid'
                                }`
                              : ''
                          }${
                            isOvertime || crossesOvertime ? ' is-overtime' : ''
                          }${compact ? ' is-compact' : ''}`}
                          style={{
                            top:
                              (dragStart - viewStartMin!) * pxPerMin + 2,
                            height: Math.max(16, dragHeight - 4),
                            left: `calc(${lane * widthPct}% + 4px)`,
                            width: `calc(${widthPct}% - 8px)`,
                            right: 'auto',
                            cursor:
                              meet || done || isLive ? undefined : 'grab',
                          }}
                          onPointerDown={
                            meet || done || isLive
                              ? undefined
                              : (ev) => onPlanBlockPointerDown(ev, t, block.rawS)
                          }
                          onPointerMove={
                            meet || done || isLive
                              ? undefined
                              : onPlanBlockPointerMove
                          }
                          onPointerUp={
                            meet || done || isLive
                              ? undefined
                              : onPlanBlockPointerUp
                          }
                          onPointerCancel={
                            meet || done || isLive
                              ? undefined
                              : () => {
                                  endPlanDrag();
                                  setPlanDragPreview(null);
                                }
                          }
                          title={
                            isLive
                              ? 'Pause the timer to move this task'
                              : meet || done
                                ? undefined
                                : 'Drag to move — snaps into free gaps'
                          }
                        >
                          <div className="cal-block-main">
                            {isLive && (
                              <span className="cal-live-tag">
                                ● In session ·{' '}
                                {formatDurationLabel(
                                  (t.actualMinutes || 0) +
                                    liveSessionSeconds(t.timerStartedAt) / 60,
                                )}
                              </span>
                            )}
                            {(isOvertime || crossesOvertime) && (
                              <span className="cal-kicker cal-overtime-tag">
                                Overtime
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
                            <span className="cal-schedule" title="Scheduled time">
                              {scheduleRange}
                            </span>
                            {!meet && !compact && (
                              <span className="cal-meta">
                                {!t.scheduleLocked ? 'Deep work' : ''}
                                {spanMin ? ` · ${spanMin}m` : ''}
                                {crossesOvertime && dayEndMin != null
                                  ? ` · after ${formatHm(dayEndMin)} overtime`
                                  : ''}
                              </span>
                            )}
                            {meet && (
                              <span className="cal-meta">Meeting</span>
                            )}
                            {isLive && (
                              <div className="cal-progress">
                                <i style={{ width: `${progress}%` }} />
                              </div>
                            )}
                          </div>
                          <span className="cal-time-end" title="Duration">
                            {spanMin}m
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
                    <em>longest {Math.round(longestSession)}m</em>
                  ) : null}
                </strong>
              </div>
              <div>
                <span className="label">Finishes at</span>
                <strong>{finishLabel}</strong>
              </div>
            </div>
            {planDragError && (
              <p className="composer-hint is-error plan-drag-error">{planDragError}</p>
            )}
            <button
              type="button"
              className="plan-fill-btn"
              onClick={() => nameInputRef.current?.focus()}
            >
              Add a task
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
            className={`add-task-composer${scheduleDate !== date ? ' is-scheduling' : ''}${scheduleDate !== today ? ' is-future' : ''}`}
            onSubmit={submitNewTask}
          >
            <input
              ref={nameInputRef}
              id="new-task-name"
              className="add-task-input"
              placeholder="Add your task"
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
            <div className="add-task-actions">
              <label
                className="add-task-dur-wrap"
                title="Duration (5–999 min). ↑↓ or buttons to adjust."
              >
                <input
                  className="add-task-dur-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={3}
                  autoComplete="off"
                  spellCheck={false}
                  value={durationDraft}
                  placeholder="30"
                  aria-label="Duration in minutes"
                  onChange={(e) => {
                    setDurationDraft(digitsOnly(e.target.value));
                    if (formError) setFormError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setDurationDraft(
                        nudgeDuration(
                          durationDraft,
                          e.shiftKey ? 1 : DURATION_STEP,
                          defaultTaskMinutes,
                        ),
                      );
                      if (formError) setFormError(null);
                      return;
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setDurationDraft(
                        nudgeDuration(
                          durationDraft,
                          e.shiftKey ? -1 : -DURATION_STEP,
                          defaultTaskMinutes,
                        ),
                      );
                      if (formError) setFormError(null);
                      return;
                    }
                    // Allow control/navigation; block letters and symbols.
                    if (
                      e.ctrlKey ||
                      e.metaKey ||
                      e.altKey ||
                      e.key === 'Backspace' ||
                      e.key === 'Delete' ||
                      e.key === 'Tab' ||
                      e.key === 'Enter' ||
                      e.key === 'Escape' ||
                      e.key === 'ArrowLeft' ||
                      e.key === 'ArrowRight' ||
                      e.key === 'Home' ||
                      e.key === 'End'
                    ) {
                      return;
                    }
                    if (!/^\d$/.test(e.key)) {
                      e.preventDefault();
                      return;
                    }
                    // Cap at 3 digits while typing
                    const el = e.currentTarget;
                    const nextLen =
                      String(el.value).length -
                      (el.selectionEnd! - el.selectionStart!) +
                      1;
                    if (nextLen > 3) e.preventDefault();
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const pasted = e.clipboardData.getData('text') || '';
                    setDurationDraft(digitsOnly(pasted));
                    if (formError) setFormError(null);
                  }}
                  onBlur={() =>
                    setDurationDraft(
                      String(
                        parseDurationInput(durationDraft, defaultTaskMinutes),
                      ),
                    )
                  }
                />
                <span className="add-task-dur-suffix">min</span>
                <span className="add-task-dur-stepper" aria-hidden={false}>
                  <button
                    type="button"
                    className="add-task-dur-step"
                    aria-label="Increase duration"
                    tabIndex={-1}
                    onClick={() => {
                      setDurationDraft(
                        nudgeDuration(
                          durationDraft,
                          DURATION_STEP,
                          defaultTaskMinutes,
                        ),
                      );
                      if (formError) setFormError(null);
                    }}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="add-task-dur-step"
                    aria-label="Decrease duration"
                    tabIndex={-1}
                    onClick={() => {
                      setDurationDraft(
                        nudgeDuration(
                          durationDraft,
                          -DURATION_STEP,
                          defaultTaskMinutes,
                        ),
                      );
                      if (formError) setFormError(null);
                    }}
                  >
                    ▼
                  </button>
                </span>
              </label>
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
                  }}
                  aria-label="Schedule date"
                />
              </label>
              <button
                className="btn btn-primary btn-pill add-task-submit"
                type="submit"
                disabled={!name.trim()}
              >
                {scheduleDate > today ? 'Schedule' : 'Add'}
              </button>
            </div>
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
                  {queueLoading ? (
                    <div className="priority-empty">Loading today’s tasks…</div>
                  ) : (
                    <>
                      {tasks.map((task, i) => (
                        <SortableTask
                          key={task.id}
                          task={task}
                          rank={i + 1}
                          timeZone={timeZone}
                          scheduleLabel={scheduleLabels.get(task.id) ?? null}
                          onStatsRefresh={invalidateStats}
                        />
                      ))}
                      {tasks.length === 0 && (
                        <div className="priority-empty">
                          No tasks yet — add one above.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </SortableContext>
            </DndContext>

            {loggedSessions.length > 0 && (
              <div className="captured-sessions">
                <h3 className="section-label">Captured sessions</h3>
                <p className="captured-sessions-hint">
                  Time logged on finished tasks (checkbox Done or Start/Stop).
                </p>
                <ul>
                  {loggedSessions.map((t) => (
                    <li key={t.id}>
                      <span className="captured-dot" aria-hidden />
                      <div>
                        <strong>{t.name}</strong>
                        <span>{Math.round(t.actualMinutes)}m captured</span>
                      </div>
                      <em>{Math.round(t.actualMinutes)}m</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <BacklogSection
              tasks={backlogTasks}
              dayTasks={tasks}
              loading={false}
              today={today}
              timeZone={timeZone}
              workStart={template?.workStart}
              workEnd={template?.workEnd}
              breaks={template?.breaks?.map((b) => ({
                start: b.start,
                end: b.end,
              }))}
              onStatsRefresh={invalidateStats}
            />
          </div>
        </section>
      </div>

      {overflowPrompt ? (
        <div
          className="overflow-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (overflowMovingNext) return;
            setOverflowPrompt(null);
          }}
        >
          <div
            className="overflow-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="overflow-modal-title"
            aria-busy={overflowMovingNext}
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="overflow-modal-title">
              You have exceeded your working hours for today.
            </h2>
            <p className="overflow-modal-body">
              {overflowPrompt.name} needs{' '}
              {formatDurationLabel(overflowPrompt.estimatedMinutes)}. Only{' '}
              {formatDurationLabel(overflowPrompt.freeMinutes)} is free.
            </p>
            <div className="overflow-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={overflowMovingNext}
                aria-busy={overflowMovingNext}
                onClick={() => {
                  if (overflowMovingNext) return;
                  const prompt = overflowPrompt;
                  setOverflowMovingNext(true);
                  void (async () => {
                    try {
                      const next = await findNextWorkingDay(
                        prompt.targetDate,
                        prompt.estimatedMinutes,
                      );
                      if (!next) {
                        setOverflowMovingNext(false);
                        setOverflowPrompt(null);
                        setFormError(
                          'No free working day found in the next two weeks.',
                        );
                        return;
                      }
                      commitNewTask({
                        targetDate: next,
                        name: prompt.name,
                        estimatedMinutes: prompt.estimatedMinutes,
                      });
                      setOverflowMovingNext(false);
                    } catch {
                      setOverflowMovingNext(false);
                      setFormError('Could not move the task to another day.');
                    }
                  })();
                }}
              >
                {overflowMovingNext ? (
                  <>
                    <span className="overflow-btn-spinner" aria-hidden />
                    Moving…
                  </>
                ) : (
                  'Move to next day'
                )}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={overflowMovingNext}
                onClick={() => {
                  const prompt = overflowPrompt;
                  commitNewTask({
                    targetDate: prompt.targetDate,
                    name: prompt.name,
                    estimatedMinutes: prompt.estimatedMinutes,
                    overflowMode: 'reprioritize',
                  });
                }}
              >
                Reprioritize tasks
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={overflowMovingNext}
                onClick={() => {
                  const prompt = overflowPrompt;
                  commitNewTask({
                    targetDate: prompt.targetDate,
                    name: prompt.name,
                    estimatedMinutes: prompt.estimatedMinutes,
                    overflowMode: 'overtime',
                    allowOvertimeSlot: true,
                  });
                }}
              >
                Add to end of the day
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={overflowMovingNext}
                onClick={() => setOverflowPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (mode !== 'live') return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [task.id, task.activeEntryId, task.timerStartedAt, mode]);

  const liveSessionSec =
    mode === 'live' ? liveSessionSeconds(task.timerStartedAt, nowMs) : 0;

  const elapsedSec = Math.max(
    0,
    Math.floor((task.actualMinutes || 0) * 60 + liveSessionSec),
  );
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
            {task.estimatedMinutes ? ` · ${task.estimatedMinutes}m` : ''}
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
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await queueCompleteTask(dispatch, {
                taskId: task.id,
                date: task.date,
                currentlyDone: task.status === 'completed',
              });
            })
          }
        >
          {task.status === 'completed' ? 'Undo' : 'Done'}
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
  dayTasks,
  loading,
  today,
  timeZone,
  workStart,
  workEnd,
  breaks,
  onStatsRefresh,
}: {
  tasks: TaskDto[];
  dayTasks: TaskDto[];
  loading: boolean;
  today: string;
  timeZone?: string | null;
  workStart?: string;
  workEnd?: string;
  breaks?: { start: string; end: string }[];
  onStatsRefresh: () => void;
}) {
  const dispatch = useAppDispatch();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (taskId: string, fn: () => Promise<unknown>) => {
    setBusyId(taskId);
    try {
      const result = await fn();
      if (
        result &&
        typeof result === 'object' &&
        'type' in result &&
        String((result as { type: string }).type).endsWith('/rejected')
      ) {
        // Soft recovery only on failure — don't thrash the list on success.
        void dispatch(fetchBacklog());
        void dispatch(fetchTasks(today));
      } else {
        onStatsRefresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="priority-section backlog-section">
      <div className="priority-header">
        <h3 className="section-label">
          Backlog <HintMark id="dash.backlog" placement="top" />
        </h3>
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
                onClick={() => {
                  const slot = nextOptimisticSlot({
                    date: today,
                    durationMin: task.estimatedMinutes,
                    tasks: dayTasks,
                    timeZone,
                    workStart,
                    workEnd,
                    breaks,
                  });
                  // Instant move onto today — don't wait for pack API.
                  dispatch(
                    tasksActions.optimisticScheduleFromBacklog({
                      taskId: task.id,
                      date: today,
                      scheduledStart: slot?.scheduledStart ?? null,
                      scheduledEnd: slot?.scheduledEnd ?? null,
                    }),
                  );
                  void run(task.id, async () => {
                    await dispatch(
                      scheduleFromBacklogOptimistic({
                        taskId: task.id,
                        date: today,
                      }),
                    );
                  });
                }}
              >
                Schedule
              </button>
              <button
                className="btn btn-ghost btn-sm backlog-quiet"
                type="button"
                disabled={busyId === task.id}
                onClick={() => {
                  void run(task.id, async () => {
                    await queueCompleteTask(dispatch, {
                      taskId: task.id,
                      date: today,
                      currentlyDone: task.status === 'completed',
                    });
                  });
                }}
              >
                Done
              </button>
              <button
                className="btn btn-ghost btn-sm backlog-quiet"
                type="button"
                disabled={busyId === task.id}
                onClick={() => {
                  dispatch(
                    tasksActions.optimisticRemoveFromBacklog({
                      taskId: task.id,
                    }),
                  );
                  void run(task.id, async () => {
                    await dispatch(
                      removeTaskOptimistic({
                        taskId: task.id,
                        date: today,
                      }),
                    );
                  });
                }}
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
  scheduleLabel,
  onStatsRefresh,
}: {
  task: TaskDto;
  rank?: number;
  timeZone?: string | null;
  scheduleLabel?: string | null;
  onStatsRefresh?: () => void;
}) {
  const locked = Boolean(task.scheduleLocked);
  const done = task.status === 'completed';
  const running = Boolean(task.activeEntryId);
  /** While timer is on, only Pause / Complete — no schedule or content edits. */
  const timerLocked = running;
  const today = todayISO(timeZone);
  const isFutureDay = task.date > today;
  const liveOtherId = useAppSelector((s) => {
    for (const list of Object.values(s.tasks.byDate)) {
      const hit = list.find((t) => t.activeEntryId && t.id !== task.id);
      if (hit) return hit.id;
    }
    return null as string | null;
  });
  const otherSessionLive = Boolean(liveOtherId);
  const canStartTimer = !done && !isFutureDay && !otherSessionLive;
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.name);
  const [minsDraft, setMinsDraft] = useState(String(task.estimatedMinutes));
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
  } = useSortable({ id: task.id, disabled: locked || done || timerLocked });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    setDraft(task.notes ?? '');
    setNameDraft(task.name);
    setMinsDraft(String(task.estimatedMinutes));
  }, [task.notes, task.name, task.estimatedMinutes, task.id]);

  useEffect(() => {
    if (!timerLocked) return;
    setEditing(false);
    setCommentsOpen(false);
    setEditError(null);
  }, [timerLocked]);

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
      onStatsRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
      void dispatch(fetchTasks(task.date));
      void dispatch(fetchBacklog());
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
    setEditError(null);
    setEditing(false);
  };

  const saveEdits = () => {
    if (timerLocked) return;
    const name = nameDraft.trim();
    if (!name) {
      setEditError('Name is required.');
      return;
    }

    const body: {
      name?: string;
      estimatedMinutes?: number;
    } = {};
    if (name !== task.name) body.name = name;

    const mins = Number(minsDraft);
    if (!Number.isFinite(mins) || mins < 5) {
      setEditError('Duration must be at least 5 minutes.');
      return;
    }
    if (Math.round(mins) !== task.estimatedMinutes) {
      body.estimatedMinutes = Math.round(mins);
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
      {locked || timerLocked ? (
        <span
          className="priority-grip is-locked"
          title={
            timerLocked
              ? 'Pause the timer to reorder'
              : 'Fixed meeting time'
          }
          aria-hidden
        >
          {timerLocked ? '●' : '⌖'}
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
        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
        aria-pressed={done}
        onClick={() => {
          // Instant toggle — never gate on API; don't refetch the whole day
          // (that races other checkboxes still syncing).
          void queueCompleteTask(dispatch, {
            taskId: task.id,
            date: task.date,
            currentlyDone: done,
          }).then(() => {
            onStatsRefresh?.();
          });
        }}
      >
        {done ? '✓' : ''}
      </button>

      <div className="priority-body">
        <div className="priority-title-row">
          {editing && !locked && !timerLocked ? (
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
              title={
                timerLocked
                  ? 'Pause the timer to edit'
                  : locked
                    ? undefined
                    : 'Click to rename'
              }
              onClick={() => {
                if (!locked && !done && !timerLocked) setEditing(true);
              }}
              style={{
                cursor: locked || done || timerLocked ? undefined : 'text',
              }}
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
          {scheduleLabel ? (
            <span className="queue-schedule" title="Scheduled time">
              {scheduleLabel}
            </span>
          ) : task.scheduledStart && task.scheduledEnd ? (
            <span className="queue-schedule" title="Scheduled time">
              {formatTimeRange(
                task.scheduledStart,
                task.scheduledEnd,
                timeZone,
              )}
            </span>
          ) : null}
          <span className="queue-cat">
            {locked || task.meetLink ? 'Meeting' : 'Deep work'}
          </span>
          {editing && !locked && !timerLocked ? (
            <span className="priority-time-edit" aria-label="Task duration">
              <input
                className="priority-mins-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                spellCheck={false}
                value={minsDraft}
                onChange={(e) => setMinsDraft(digitsOnly(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEdits();
                    return;
                  }
                  if (
                    e.ctrlKey ||
                    e.metaKey ||
                    e.altKey ||
                    e.key === 'Backspace' ||
                    e.key === 'Delete' ||
                    e.key === 'Tab' ||
                    e.key === 'Escape' ||
                    e.key === 'ArrowLeft' ||
                    e.key === 'ArrowRight' ||
                    e.key === 'Home' ||
                    e.key === 'End'
                  ) {
                    return;
                  }
                  if (!/^\d$/.test(e.key)) {
                    e.preventDefault();
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  setMinsDraft(digitsOnly(e.clipboardData.getData('text') || ''));
                }}
                onBlur={() =>
                  setMinsDraft(
                    String(parseDurationInput(minsDraft, task.estimatedMinutes)),
                  )
                }
                aria-label="Duration minutes"
              />
              <span>m</span>
            </span>
          ) : (
            <button
              type="button"
              className="priority-mins-btn"
              onClick={() => {
                if (!locked && !done && !timerLocked) setEditing(true);
              }}
              disabled={locked || done || timerLocked}
              title={
                timerLocked
                  ? 'Pause the timer to change duration'
                  : locked
                    ? undefined
                    : 'Edit duration'
              }
            >
              {task.estimatedMinutes}m
            </button>
          )}
          {task.actualMinutes > 0 ? ` · ${Math.round(task.actualMinutes)}m actual` : ''}
          {editing && !locked && !timerLocked && (
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
            <div className="task-comments-head">
              <label className="task-comments-label" htmlFor={`notes-${task.id}`}>
                Comments
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-pill btn-sm task-comments-collapse"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCommentsOpen(false);
                }}
              >
                Collapse
              </button>
            </div>
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
        <UiTooltip
          label={
            timerLocked
              ? 'Pause the timer to edit notes'
              : commentsOpen
                ? 'Hide notes'
                : 'Notes'
          }
          placement="top"
        >
          <button
            className={`btn btn-ghost btn-pill btn-sm priority-icon-btn${commentsOpen ? ' is-active' : ''}`}
            type="button"
            aria-label={commentsOpen ? 'Hide notes' : 'Notes'}
            aria-expanded={commentsOpen}
            disabled={timerLocked}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (timerLocked) return;
              setCommentsOpen((o) => !o);
            }}
          >
            <NotesIcon />
            {hasNotes && !commentsOpen ? (
              <i className="priority-icon-dot" aria-hidden />
            ) : null}
          </button>
        </UiTooltip>
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
        {!locked && !done && !timerLocked && (
          <UiTooltip label="Park in Backlog" placement="top">
            <button
              className="btn btn-ghost btn-pill btn-sm priority-icon-btn"
              type="button"
              disabled={busy}
              aria-label="Park in Backlog"
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
              <ParkIcon />
            </button>
          </UiTooltip>
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
                  : otherSessionLive
                    ? 'Pause the current session first'
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
