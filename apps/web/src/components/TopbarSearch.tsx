'use client';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { CalendarEventDto, TaskDto } from '@timeblock/shared-types';
import {
  api,
  formatTimeRange,
  shiftDateISO,
  todayISO,
} from '../api';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchBacklog, fetchTasks } from '../store/tasksSlice';

type SearchHit = {
  id: string;
  kind: 'task' | 'event' | 'session';
  title: string;
  meta: string;
  href: string;
};

function matches(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle);
}

function taskMeta(task: TaskDto, timeZone?: string | null) {
  const bits: string[] = [];
  if (task.inBacklog) bits.push('Backlog');
  else bits.push(task.date);
  if (task.scheduledStart && task.scheduledEnd) {
    bits.push(formatTimeRange(task.scheduledStart, task.scheduledEnd, timeZone));
  } else if (task.estimatedMinutes) {
    bits.push(`${task.estimatedMinutes}m`);
  }
  if (task.status === 'completed') bits.push('Done');
  else if (task.activeEntryId) bits.push('Live');
  return bits.join(' · ');
}

export function TopbarSearch({ timeZone }: { timeZone?: string | null }) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const deferred = useDeferredValue(query.trim().toLowerCase());

  const byDate = useAppSelector((s) => s.tasks.byDate);
  const backlog = useAppSelector((s) => s.tasks.backlog);

  const today = todayISO(timeZone);
  const searchDates = useMemo(
    () => [
      shiftDateISO(today, -1),
      today,
      shiftDateISO(today, 1),
      shiftDateISO(today, 2),
    ],
    [today],
  );

  const wantsData = open || deferred.length > 0;

  useEffect(() => {
    if (!wantsData) return;
    for (const date of searchDates) {
      void dispatch(fetchTasks(date));
    }
    void dispatch(fetchBacklog());
  }, [wantsData, searchDates, dispatch]);

  const remoteTasks = useQueries({
    queries: searchDates.map((date) => ({
      queryKey: ['tasks', date] as const,
      queryFn: () => api.get<TaskDto[]>(`/api/tasks?date=${date}`),
      enabled: wantsData,
      staleTime: 60_000,
    })),
  });

  const eventsQuery = useQuery({
    queryKey: ['events', today],
    queryFn: () =>
      api.get<CalendarEventDto[]>(`/api/calendar/events?date=${today}`),
    enabled: wantsData,
    staleTime: 60_000,
  });

  const allTasks = useMemo(() => {
    const map = new Map<string, TaskDto>();
    for (const list of Object.values(byDate)) {
      for (const t of list) map.set(t.id, t);
    }
    for (const t of backlog) map.set(t.id, t);
    for (const q of remoteTasks) {
      for (const t of q.data ?? []) map.set(t.id, t);
    }
    return [...map.values()];
  }, [byDate, backlog, remoteTasks]);

  const hits = useMemo((): SearchHit[] => {
    if (!deferred) return [];
    const out: SearchHit[] = [];

    for (const task of allTasks) {
      const blob = `${task.name} ${task.notes ?? ''} ${task.meetLink ?? ''}`;
      if (!matches(blob, deferred)) continue;

      const isSession =
        task.status === 'completed' || (task.actualMinutes ?? 0) > 0;

      out.push({
        id: `task:${task.id}`,
        kind: isSession && task.status === 'completed' ? 'session' : 'task',
        title: task.name,
        meta: taskMeta(task, timeZone),
        href:
          task.status === 'completed'
            ? '/timesheet'
            : task.inBacklog
              ? '/schedule'
              : task.date === today
                ? '/schedule'
                : `/schedule`,
      });
    }

    for (const ev of eventsQuery.data ?? []) {
      const blob = `${ev.title} ${ev.meetLink ?? ''} ${ev.provider}`;
      if (!matches(blob, deferred)) continue;
      out.push({
        id: `event:${ev.id}`,
        kind: 'event',
        title: ev.title || 'Calendar event',
        meta: `${ev.provider} · ${formatTimeRange(ev.start, ev.end, timeZone)}`,
        href: '/schedule',
      });
    }

    // Prefer live/active, then tasks, then sessions/events
    const rank = (h: SearchHit) =>
      h.meta.includes('Live') ? 0 : h.kind === 'task' ? 1 : h.kind === 'event' ? 2 : 3;
    out.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
    return out.slice(0, 12);
  }, [deferred, allTasks, eventsQuery.data, timeZone, today]);

  useEffect(() => {
    setActiveIdx(0);
  }, [deferred]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      setQuery('');
      try {
        sessionStorage.setItem('tb.searchFocus', hit.id);
      } catch {
        /* ignore */
      }
      router.push(hit.href);
    },
    [router],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[activeIdx];
      if (hit) go(hit);
    }
  };

  const showPanel = open && query.trim().length > 0;
  const loading =
    wantsData &&
    remoteTasks.some((q) => q.isLoading) &&
    allTasks.length === 0;

  return (
    <div
      className={`search-bar${showPanel ? ' is-open' : ''}`}
      ref={rootRef}
      role="search"
    >
      <span aria-hidden>⌕</span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Search tasks, sessions, events…"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={showPanel}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {query ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
        >
          ×
        </button>
      ) : null}

      {showPanel ? (
        <div className="search-results" id={listId} role="listbox">
          {loading ? (
            <div className="search-empty">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="search-empty">No matches for “{query.trim()}”</div>
          ) : (
            hits.map((hit, idx) => (
              <button
                key={hit.id}
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                className={`search-hit${idx === activeIdx ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => go(hit)}
              >
                <span className={`search-kind is-${hit.kind}`}>{hit.kind}</span>
                <span className="search-hit-copy">
                  <strong>{hit.title}</strong>
                  <span>{hit.meta}</span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
