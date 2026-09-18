'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StatsOverviewDto, TaskDto } from '@timeblock/shared-types';
import { api, formatTimeRange, parseInstant, todayISO } from '../api';
import { MeetSourceBadge } from '../components/MeetSourceBadge';

type Filter = 'all' | 'open' | 'done';

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

function sortTodayTasks(tasks: TaskDto[], timeZone?: string | null) {
  return [...tasks]
    .filter((t) => !t.inBacklog)
    .sort((a, b) => {
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (b.status === 'completed' && a.status !== 'completed') return -1;
      if (a.scheduledStart && b.scheduledStart) {
        return (
          minutesOf(a.scheduledStart, timeZone) -
          minutesOf(b.scheduledStart, timeZone)
        );
      }
      if (a.scheduledStart) return -1;
      if (b.scheduledStart) return 1;
      return a.order - b.order;
    });
}

export function TodayTasksPage({ timeZone }: { timeZone?: string | null }) {
  const date = todayISO(timeZone);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [activeId, setActiveId] = useState<string | null>(null);

  const statsQ = useQuery({
    queryKey: ['stats', date],
    queryFn: () =>
      api.get<StatsOverviewDto>(`/api/stats/overview?date=${date}`),
  });
  const tasksQ = useQuery({
    queryKey: ['tasks', date],
    queryFn: () => api.get<TaskDto[]>(`/api/tasks?date=${date}`),
  });

  const allTasks = useMemo(
    () => sortTodayTasks(tasksQ.data ?? [], timeZone),
    [tasksQ.data, timeZone],
  );
  const tasks = useMemo(() => {
    if (filter === 'open') {
      return allTasks.filter((t) => t.status !== 'completed');
    }
    if (filter === 'done') {
      return allTasks.filter((t) => t.status === 'completed');
    }
    return allTasks;
  }, [allTasks, filter]);

  const util = statsQ.data?.utilization;
  const today = statsQ.data?.today;
  const pct = util?.utilizationPercent ?? 0;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['tasks', date] });
    void qc.invalidateQueries({ queryKey: ['stats', date] });
    void qc.invalidateQueries({ queryKey: ['eod', date] });
    void qc.invalidateQueries({ queryKey: ['backlog'] });
  };

  const dateLabel = useMemo(() => {
    return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, [date]);

  const activeTask = allTasks.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    if (activeId && !allTasks.some((t) => t.id === activeId)) {
      setActiveId(null);
    }
  }, [allTasks, activeId]);

  return (
    <div className="today-workspace">
      <header className="tw-header">
        <div>
          <p className="tw-kicker">Today</p>
          <h1 className="page-title">Assigned work</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {dateLabel}
          </p>
        </div>
        <Link href="/schedule" className="btn btn-outline btn-pill">
          Open schedule
        </Link>
      </header>

      <section className="tw-metrics" aria-label="Today metrics">
        <div className="tw-metric-card tw-metric-main">
          <div className="tw-metric-top">
            <span>Day utilization</span>
            <strong>{pct}%</strong>
          </div>
          <div className="tw-progress" aria-hidden>
            <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
          </div>
          <p className="tw-metric-sub">
            {util
              ? `${util.scheduledMinutes} of ${util.availableMinutes} min booked`
              : 'No schedule hours set'}
          </p>
        </div>
        <div className="tw-metric-card">
          <strong>{today?.total ?? 0}</strong>
          <span>Total tasks</span>
        </div>
        <div className="tw-metric-card">
          <strong>{today?.completed ?? 0}</strong>
          <span>Completed</span>
        </div>
        <div className="tw-metric-card">
          <strong>{today?.pending ?? 0}</strong>
          <span>Open</span>
        </div>
      </section>

      <div className="tw-layout">
        <section className="tw-list-panel">
          <div className="tw-list-head">
            <h2>Assigned tasks</h2>
            <div className="tw-filters" role="tablist" aria-label="Filter tasks">
              {(
                [
                  ['all', 'All'],
                  ['open', 'Open'],
                  ['done', 'Done'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  className={`tw-filter${filter === key ? ' is-on' : ''}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {tasksQ.isLoading && <div className="tw-empty">Loading…</div>}
          {!tasksQ.isLoading && tasks.length === 0 && (
            <div className="tw-empty">
              No tasks in this view.
              <Link href="/schedule">Add from schedule</Link>
            </div>
          )}

          <ul className="tw-task-list">
            {tasks.map((task) => {
              const locked = Boolean(task.scheduleLocked);
              const done = task.status === 'completed';
              const running = Boolean(task.activeEntryId);
              const selected = activeId === task.id;
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    className={[
                      'tw-task',
                      selected ? 'is-selected' : '',
                      done ? 'is-done' : '',
                      running ? 'is-live' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setActiveId(task.id)}
                  >
                    <div className="tw-task-copy">
                      <span className="tw-task-time">
                        {task.scheduledStart
                          ? formatTimeRange(
                              task.scheduledStart,
                              task.scheduledEnd,
                              timeZone,
                            )
                          : 'Unscheduled'}
                      </span>
                      <strong>{task.name}</strong>
                      <span className="tw-task-meta">
                        {task.estimatedMinutes}m est
                        {task.actualMinutes > 0
                          ? ` · ${task.actualMinutes}m actual`
                          : ''}
                      </span>
                    </div>
                    {running || done || !locked ? (
                      <span
                        className={[
                          'tw-chip',
                          running ? 'is-live' : '',
                          done ? 'is-done' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {running ? 'Live' : done ? 'Done' : 'Task'}
                      </span>
                    ) : (
                      <MeetSourceBadge
                        sourceProvider={task.sourceProvider}
                        meetLink={task.meetLink}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="tw-detail-panel">
          {!activeTask ? (
            <div className="tw-detail-empty">
              <p>Select a task</p>
              <span>Edit details, comments, or status here.</span>
            </div>
          ) : (
            <TaskDetail
              key={activeTask.id}
              task={activeTask}
              timeZone={timeZone}
              onChanged={invalidate}
              onDeleted={() => {
                setActiveId(null);
                invalidate();
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function TaskDetail({
  task,
  timeZone,
  onChanged,
  onDeleted,
}: {
  task: TaskDto;
  timeZone?: string | null;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const locked = Boolean(task.scheduleLocked);
  const done = task.status === 'completed';
  const running = Boolean(task.activeEntryId);
  const [nameDraft, setNameDraft] = useState(task.name);
  const [minsDraft, setMinsDraft] = useState(String(task.estimatedMinutes));
  const [notesDraft, setNotesDraft] = useState(task.notes ?? '');
  const [comment, setComment] = useState('');

  useEffect(() => {
    setNameDraft(task.name);
    setMinsDraft(String(task.estimatedMinutes));
    setNotesDraft(task.notes ?? '');
    setComment('');
  }, [task.id, task.name, task.estimatedMinutes, task.notes]);

  const saveMeta = useMutation({
    mutationFn: (body: { name?: string; estimatedMinutes?: number }) =>
      api.patch<TaskDto>(`/api/tasks/${task.id}`, body),
    onSuccess: () => onChanged(),
  });
  const saveNotes = useMutation({
    mutationFn: (notes: string | null) =>
      api.patch<TaskDto>(`/api/tasks/${task.id}`, { notes }),
    onSuccess: () => {
      setComment('');
      onChanged();
    },
  });
  const complete = useMutation({
    mutationFn: () => api.patch<TaskDto>(`/api/tasks/${task.id}/complete`),
    onSuccess: () => onChanged(),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/tasks/${task.id}`),
    onSuccess: () => onDeleted(),
  });
  const start = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/timer/${task.id}/start`),
    onSuccess: () => onChanged(),
  });
  const stop = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/timer/${task.id}/stop`),
    onSuccess: () => onChanged(),
  });

  const busy =
    saveMeta.isPending ||
    saveNotes.isPending ||
    complete.isPending ||
    remove.isPending ||
    start.isPending ||
    stop.isPending;

  const dirtyMeta =
    nameDraft.trim() !== task.name ||
    (!locked &&
      Number.isFinite(Number(minsDraft)) &&
      Math.round(Number(minsDraft)) !== task.estimatedMinutes);
  const dirtyNotes = notesDraft !== (task.notes ?? '');

  const onSave = () => {
    const name = nameDraft.trim();
    if (!name) return;
    const body: { name?: string; estimatedMinutes?: number } = {};
    if (name !== task.name) body.name = name;
    const mins = Number(minsDraft);
    if (
      !locked &&
      Number.isFinite(mins) &&
      mins >= 5 &&
      Math.round(mins) !== task.estimatedMinutes
    ) {
      body.estimatedMinutes = Math.round(mins);
    }
    if (Object.keys(body).length) saveMeta.mutate(body);
    if (dirtyNotes) saveNotes.mutate(notesDraft.trim() || null);
  };

  const onAddComment = () => {
    const line = comment.trim();
    if (!line) return;
    const stamp = new Date().toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timeZone || undefined,
    });
    const next = [
      notesDraft.trim(),
      notesDraft.trim() ? '' : null,
      `[${stamp}]`,
      line,
    ]
      .filter((x) => x != null)
      .join('\n');
    setNotesDraft(next);
    saveNotes.mutate(next);
  };

  return (
    <div className="tw-detail">
      <div className="tw-detail-head">
        <div>
          <p className="tw-detail-time">
            {task.scheduledStart
              ? formatTimeRange(task.scheduledStart, task.scheduledEnd, timeZone)
              : 'Unscheduled'}
          </p>
          <h3>{task.name}</h3>
        </div>
        {running || done || !locked ? (
          <span
            className={[
              'tw-chip',
              running ? 'is-live' : '',
              done ? 'is-done' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {running ? 'Live' : done ? 'Done' : 'Task'}
          </span>
        ) : (
          <MeetSourceBadge
            sourceProvider={task.sourceProvider}
            meetLink={task.meetLink}
            size={16}
          />
        )}
      </div>

      {!locked && (
        <label className="tw-field">
          <span>Task name</span>
          <input
            value={nameDraft}
            disabled={done}
            onChange={(e) => setNameDraft(e.target.value)}
          />
        </label>
      )}

      {!locked && (
        <label className="tw-field tw-field-inline">
          <span>Duration</span>
          <div>
            <input
              type="number"
              min={5}
              step={5}
              value={minsDraft}
              disabled={done}
              onChange={(e) => setMinsDraft(e.target.value)}
            />
            <em>minutes</em>
          </div>
        </label>
      )}

      <label className="tw-field">
        <span>Comments</span>
        <textarea
          rows={5}
          value={notesDraft}
          placeholder="Notes stay with this task"
          onChange={(e) => setNotesDraft(e.target.value)}
        />
      </label>

      <div className="tw-comment-add">
        <input
          type="text"
          value={comment}
          placeholder="Add a comment"
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAddComment();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !comment.trim()}
          onClick={onAddComment}
        >
          Add
        </button>
      </div>

      <div className="tw-detail-actions">
        {!done && (
          <>
            {running ? (
              <button
                type="button"
                className="btn btn-outline btn-pill"
                disabled={busy}
                onClick={() => stop.mutate()}
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-pill"
                disabled={busy}
                onClick={() => start.mutate()}
              >
                Start
              </button>
            )}
            <button
              type="button"
              className="btn btn-soft btn-pill"
              disabled={busy}
              onClick={() => complete.mutate()}
            >
              Mark done
            </button>
            {!locked && (
              <button
                type="button"
                className="btn btn-primary btn-pill"
                disabled={busy || (!dirtyMeta && !dirtyNotes)}
                onClick={onSave}
              >
                Save
              </button>
            )}
          </>
        )}
        {!locked && (
          <button
            type="button"
            className="btn btn-ghost tw-delete"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete “${task.name}”?`)) {
                remove.mutate();
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
