'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { EodSheet } from '../components/EodSheet';
import { MeetSourceBadge } from '../components/MeetSourceBadge';
import type {
  CalendarEventDto,
  DailyScheduleTemplateDto,
  EodSheetDto,
  StatsOverviewDto,
  TaskDto,
} from '@timeblock/shared-types';

const TONES = ['tone-blue', 'tone-coral', 'tone-teal', 'tone-white'] as const;
const MIN_PX_PER_MIN = 0.85;
const MAX_PX_PER_MIN = 2.2;

function parseHm(hm: string) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function formatHm(total: number) {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

  const tasksQ = useQuery({
    queryKey: ['tasks', date],
    queryFn: () => api.get<TaskDto[]>(`/api/tasks?date=${date}`),
  });
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
    queryFn: () => api.get<DailyScheduleTemplateDto[]>('/api/schedule'),
  });
  const eodQ = useQuery({
    queryKey: ['eod', date],
    queryFn: () => api.get<EodSheetDto>(`/api/stats/eod?date=${date}`),
  });

  const backlogQ = useQuery({
    queryKey: ['backlog'],
    queryFn: () => api.get<TaskDto[]>('/api/tasks/backlog'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['tasks', date] });
    void qc.invalidateQueries({ queryKey: ['backlog'] });
    void qc.invalidateQueries({ queryKey: ['stats', date] });
    void qc.invalidateQueries({ queryKey: ['schedule'] });
    void qc.invalidateQueries({ queryKey: ['eod', date] });
    void qc.invalidateQueries({ queryKey: ['weekly'] });
    void qc.invalidateQueries({ queryKey: ['events', date] });
  };

  const createTask = useMutation({
    mutationFn: (payload: {
      name: string;
      estimatedMinutes: number;
      startTime?: string;
      endTime?: string;
    }) =>
      api.post<TaskDto>('/api/tasks', {
        date,
        name: payload.name,
        estimatedMinutes: payload.estimatedMinutes,
        ...(payload.startTime && payload.endTime
          ? { startTime: payload.startTime, endTime: payload.endTime }
          : {}),
      }),
    onSuccess: (task) => {
      setName('');
      setFormError(null);
      if (task.inBacklog) {
        setCreateHint(
          `"${task.name}" had no free slot today — moved to Backlog.`,
        );
      } else {
        setCreateHint(null);
      }
      const nextStart = defaultStart();
      setStartTime(nextStart);
      setEndTime(defaultEnd(nextStart));
      invalidate();
      nameInputRef.current?.focus();
    },
    onError: (err) => {
      setFormError(
        err instanceof Error ? err.message : 'Could not add task',
      );
    },
  });

  const submitNewTask = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Enter a task name to add it.');
      nameInputRef.current?.focus();
      return;
    }
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
      setFormError(null);
      createTask.mutate({
        name: trimmed,
        estimatedMinutes: mins,
        startTime,
        endTime,
      });
      return;
    }
    setFormError(null);
    createTask.mutate({
      name: trimmed,
      estimatedMinutes: defaultTaskMinutes,
    });
  };

  const reorder = useMutation({
    mutationFn: (taskIds: string[]) =>
      api.post<TaskDto[]>('/api/tasks/reorder', { date, taskIds }),
    onSuccess: () => invalidate(),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const tasks = useMemo(() => {
    const list = [...(tasksQ.data ?? [])];
    list.sort((a, b) => {
      if (a.scheduledStart && b.scheduledStart) {
        return a.scheduledStart.localeCompare(b.scheduledStart);
      }
      if (a.scheduledStart) return -1;
      if (b.scheduledStart) return 1;
      return a.order - b.order;
    });
    return list;
  }, [tasksQ.data]);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const template = scheduleQ.data?.find((t) => t.weekday === weekday);

  const dayStartMin = template ? parseHm(template.workStart) : null;
  const dayEndMin = template ? parseHm(template.workEnd) : null;
  const hasSchedule = dayStartMin !== null && dayEndMin !== null;

  // Expand timeline past work hours so evening Meet blocks (e.g. 9–11pm IST) show
  const { viewStartMin, viewEndMin } = useMemo(() => {
    if (!hasSchedule) {
      return {
        viewStartMin: null as number | null,
        viewEndMin: null as number | null,
      };
    }
    let start = dayStartMin!;
    let end = dayEndMin!;
    for (const ev of eventsQ.data ?? []) {
      start = Math.min(start, minutesOf(ev.start, timeZone));
      end = Math.max(end, minutesOf(ev.end, timeZone));
    }
    for (const t of tasks) {
      if (!t.scheduledStart || !t.scheduledEnd) continue;
      start = Math.min(start, minutesOf(t.scheduledStart, timeZone));
      end = Math.max(end, minutesOf(t.scheduledEnd, timeZone));
    }
    // Snap to hour boundaries; clamp to a civil day
    start = Math.max(0, Math.floor(start / 60) * 60);
    end = Math.min(24 * 60, Math.ceil(end / 60) * 60);
    if (end <= start) end = start + 60;
    return { viewStartMin: start, viewEndMin: end };
  }, [hasSchedule, dayStartMin, dayEndMin, eventsQ.data, tasks, timeZone]);

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

  // Fit the full day into the available height so every block is visible
  const pxPerMin = useMemo(() => {
    if (!span) return 1.2;
    const usable = Math.max(viewportH - 8, 360);
    return Math.min(MAX_PX_PER_MIN, Math.max(MIN_PX_PER_MIN, usable / span));
  }, [span, viewportH]);

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
    const next = arrayMove(tasks, oldIndex, newIndex);
    qc.setQueryData(['tasks', date], next);
    // Only persist order for user-created (unlocked) tasks
    const unlockedIds = next.filter((t) => !t.scheduleLocked).map((t) => t.id);
    reorder.mutate(unlockedIds);
  };

  const dateLabel = useMemo(() => {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, [date]);

  return (
    <div className="today-page">
      <div className="schedule-header">
        <div>
          <h1 className="page-title">My Schedule</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Add tasks as you think of them — they pack into free slots. Browse
            past days anytime.
          </p>
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
          <div className="date-nav-label">
            <strong>{dateLabel}</strong>
            {!isToday && <span className="date-nav-chip">Archive</span>}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm date-nav-btn"
            aria-label="Next day"
            onClick={() => setDate((d) => shiftDateISO(d, 1))}
          >
            ›
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
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="label">Total today</div>
          <div className="value">{statsQ.data?.today.total ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Completed today</div>
          <div className="value">{statsQ.data?.today.completed ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pending today</div>
          <div className="value">{statsQ.data?.today.pending ?? 0}</div>
        </div>
      </div>

      <form className="add-task-composer" onSubmit={submitNewTask}>
        <input
          ref={nameInputRef}
          id="new-task-name"
          className="add-task-input"
          placeholder="Add your task"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (formError) setFormError(null);
            if (createHint) setCreateHint(null);
          }}
          aria-invalid={Boolean(formError)}
        />
        <button
          type="button"
          className={`add-task-pin-btn${pinTime ? ' is-on' : ''}`}
          aria-pressed={pinTime}
          onClick={() => setPinTime((v) => !v)}
        >
          Pin time
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
              title="Start time"
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
              title="End time"
              aria-label="End time"
            />
          </div>
        )}
        <button
          className="btn btn-primary btn-pill"
          type="submit"
          disabled={createTask.isPending || !name.trim()}
        >
          {createTask.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
      {(formError || createTask.isError) && (
        <p className="composer-hint is-error">
          {formError ||
            (createTask.error as Error)?.message ||
            'Could not add task'}
        </p>
      )}
      {createHint && !formError && (
        <p className="composer-hint">{createHint}</p>
      )}

      <div className="schedule-board schedule-board--fill">
        <div className="cal-toolbar">
          <div>
            <h3 className="section-label" style={{ marginBottom: 2 }}>
              Calendar view
            </h3>
            <p className="cal-toolbar-meta">
              {hasSchedule
                ? `${formatHm(viewStartMin!)} – ${formatHm(viewEndMin!)}`
                : 'No schedule'}
              {timeZone ? ` · ${timeZone}` : ''}
            </p>
          </div>
          <div className="cal-legend" aria-label="Calendar color legend">
            <span className="cal-legend-caption">Legend</span>
            <span className="cal-legend-item">
              <i className="swatch work" /> Work
            </span>
            <span className="cal-legend-item">
              <i className="swatch break" /> Break
            </span>
            <span className="cal-legend-item">
              <i className="swatch meet" /> Meet
            </span>
            <span className="cal-legend-item">
              <i className="swatch task" /> Task
            </span>
          </div>
        </div>

        {!hasSchedule ? (
          <div className="card" style={{ padding: 16 }}>
            No work hours for today. Open Settings and save a daily schedule
            profile for this weekday to pack tasks around your Meet blocks.
          </div>
        ) : (
          <div className="day-timeline-viewport" ref={viewportRef}>
            <div className="day-timeline" style={{ height: timelineH }}>
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
                <div
                  className="day-work-band"
                  style={{
                    top: (dayStartMin! - viewStartMin!) * pxPerMin,
                    height: Math.max(
                      (dayEndMin! - dayStartMin!) * pxPerMin,
                      4,
                    ),
                  }}
                />

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
                  return (
                    <div
                      key={b.id}
                      className="cal-block break"
                      style={{
                        top: (s - viewStartMin!) * pxPerMin,
                        height: Math.max((e - s) * pxPerMin, 22),
                      }}
                    >
                      <strong>{b.name}</strong>
                      <span>
                        {b.start} – {b.end}
                      </span>
                    </div>
                  );
                })}

                {orphanEvents.map((ev) => {
                  const s = Math.max(
                    minutesOf(ev.start, timeZone),
                    viewStartMin!,
                  );
                  const e = Math.min(minutesOf(ev.end, timeZone), viewEndMin!);
                  if (e <= viewStartMin! || s >= viewEndMin!) return null;
                  return (
                    <div
                      key={ev.id}
                      className={`cal-block busy${ev.meetLink ? ' meet' : ''}`}
                      style={{
                        top: (s - viewStartMin!) * pxPerMin,
                        height: Math.max((e - s) * pxPerMin, 28),
                      }}
                    >
                      <strong>{ev.title}</strong>
                      <span>{formatTimeRange(ev.start, ev.end, timeZone)}</span>
                      {ev.meetLink && (
                        <a
                          href={ev.meetLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(click) => click.stopPropagation()}
                        >
                          Join Meet
                        </a>
                      )}
                    </div>
                  );
                })}

                {tasks
                  .filter((t) => t.scheduledStart && t.scheduledEnd)
                  .map((t, i) => {
                    const rawS = minutesOf(t.scheduledStart!, timeZone);
                    const rawE = minutesOf(t.scheduledEnd!, timeZone);
                    const s = Math.max(rawS, viewStartMin!);
                    const e = Math.min(rawE, viewEndMin!);
                    if (e <= s) return null;
                    const meet = Boolean(t.scheduleLocked || t.meetLink);
                    return (
                      <div
                        key={t.id}
                        className={`cal-block ${
                          meet
                            ? 'busy meet'
                            : `task ${TONES[i % TONES.length]}`
                        }${t.status === 'completed' ? ' is-done' : ''}`}
                        style={{
                          top: (s - viewStartMin!) * pxPerMin,
                          height: Math.max((e - s) * pxPerMin, 30),
                        }}
                      >
                        <strong>
                          {meet ? t.name : `#${t.order + 1} ${t.name}`}
                          {t.status === 'completed' ? ' ✓' : ''}
                        </strong>
                        <span>
                          {formatTimeRange(
                            t.scheduledStart,
                            t.scheduledEnd,
                            timeZone,
                          )}
                          {!meet ? ` · ${t.estimatedMinutes}m` : ''}
                        </span>
                        {t.meetLink && (
                          <a
                            href={t.meetLink}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(click) => click.stopPropagation()}
                          >
                            Join Meet
                          </a>
                        )}
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

      <EodSheet
        data={eodQ.data}
        loading={eodQ.isLoading}
        timeZone={timeZone}
        compact
      />

      <div className="priority-section">
        <div className="priority-header">
          <div>
            <h3 className="section-label" style={{ marginBottom: 2 }}>
              Today’s tasks
            </h3>
            <p className="priority-sub">
              Drag to reorder. Meetings stay fixed.
            </p>
          </div>
          <span className="priority-count">
            {tasks.filter((t) => !t.scheduleLocked && t.status !== 'completed').length}
          </span>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="priority-list">
              {tasks.map((task, i) => (
                <SortableTask
                  key={task.id}
                  task={task}
                  rank={i + 1}
                  timeZone={timeZone}
                  onChanged={invalidate}
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
      </div>

      <BacklogSection
        tasks={backlogQ.data ?? []}
        loading={backlogQ.isLoading}
        today={today}
        timeZone={timeZone}
        onChanged={invalidate}
      />
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
  const scheduleToday = useMutation({
    mutationFn: (taskId: string) =>
      api.post<TaskDto>(`/api/tasks/${taskId}/schedule`, { date: today }),
    onSuccess: () => onChanged(),
  });
  const completeTask = useMutation({
    mutationFn: (taskId: string) =>
      api.patch<TaskDto>(`/api/tasks/${taskId}/complete`),
    onSuccess: () => onChanged(),
  });
  const removeTask = useMutation({
    mutationFn: (taskId: string) => api.delete(`/api/tasks/${taskId}`),
    onSuccess: () => onChanged(),
  });

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
                disabled={scheduleToday.isPending}
                onClick={() => scheduleToday.mutate(task.id)}
              >
                Schedule
              </button>
              <button
                className="btn btn-ghost btn-sm backlog-quiet"
                type="button"
                disabled={completeTask.isPending}
                onClick={() => completeTask.mutate(task.id)}
              >
                Done
              </button>
              <button
                className="btn btn-ghost btn-sm backlog-quiet"
                type="button"
                disabled={removeTask.isPending}
                onClick={() => removeTask.mutate(task.id)}
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
  rank,
  timeZone,
  onChanged,
}: {
  task: TaskDto;
  rank: number;
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

  const start = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/timer/${task.id}/start`),
    onSuccess: () => onChanged(),
  });
  const stop = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/timer/${task.id}/stop`),
    onSuccess: () => onChanged(),
  });
  const completeTask = useMutation({
    mutationFn: () => api.patch<TaskDto>(`/api/tasks/${task.id}/complete`),
    onSuccess: () => onChanged(),
  });
  const saveNotes = useMutation({
    mutationFn: (notes: string | null) =>
      api.patch<TaskDto>(`/api/tasks/${task.id}`, { notes }),
    onSuccess: () => {
      setAppendText('');
      onChanged();
    },
  });
  const saveMeta = useMutation({
    mutationFn: (body: {
      name?: string;
      estimatedMinutes?: number;
      startTime?: string;
      endTime?: string;
    }) => api.patch<TaskDto>(`/api/tasks/${task.id}`, body),
    onSuccess: () => {
      setEditing(false);
      setEditError(null);
      onChanged();
    },
  });
  const toBacklog = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/tasks/${task.id}/backlog`),
    onSuccess: () => onChanged(),
  });

  const busy =
    start.isPending ||
    stop.isPending ||
    completeTask.isPending ||
    saveNotes.isPending ||
    saveMeta.isPending ||
    toBacklog.isPending;
  const actionError =
    editError ||
    (start.error as Error | null)?.message ||
    (stop.error as Error | null)?.message ||
    (completeTask.error as Error | null)?.message ||
    (saveNotes.error as Error | null)?.message ||
    (saveMeta.error as Error | null)?.message ||
    (toBacklog.error as Error | null)?.message ||
    null;

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
    saveNotes.mutate(next);
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
    saveMeta.mutate(body);
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

      <div className="priority-rank" aria-label={locked ? 'Meet' : `Priority ${rank}`}>
        {locked ? 'M' : rank}
      </div>

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
              {done ? ' ✓' : ''}
            </strong>
          )}
          {locked && (
            <MeetSourceBadge
              sourceProvider={task.sourceProvider}
              meetLink={task.meetLink}
            />
          )}
          {running && <span className="priority-badge live">Live</span>}
          {done && !locked && <span className="priority-badge done">Done</span>}
          {hasNotes && !commentsOpen && (
            <span className="priority-badge notes" title="Has comments">
              Notes
            </span>
          )}
        </div>
        <div className="priority-meta">
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
                    {task.estimatedMinutes}m est
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
          <div className="priority-error">{actionError}</div>
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
                onClick={() => saveNotes.mutate(draft.trim() || null)}
              >
                {saveNotes.isPending ? 'Saving…' : 'Save'}
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
            onClick={() => toBacklog.mutate()}
          >
            Backlog
          </button>
        )}
        {running ? (
          <button
            className="btn btn-primary btn-pill btn-sm"
            type="button"
            disabled={busy}
            onClick={() => stop.mutate()}
          >
            {stop.isPending ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <button
            className="btn btn-outline btn-pill btn-sm"
            type="button"
            disabled={done || busy}
            onClick={() => start.mutate()}
          >
            {start.isPending ? 'Starting…' : 'Start'}
          </button>
        )}
        <button
          className="btn btn-soft btn-pill btn-sm"
          type="button"
          disabled={done || busy}
          title={
            done
              ? 'Already completed'
              : running
                ? 'Stops the timer and marks complete'
                : 'Mark complete'
          }
          onClick={() => completeTask.mutate()}
        >
          {completeTask.isPending ? 'Saving…' : 'Done'}
        </button>
      </div>
    </div>
  );
}
