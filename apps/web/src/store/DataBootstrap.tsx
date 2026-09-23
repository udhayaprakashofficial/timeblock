'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StatsOverviewDto } from '@timeblock/shared-types';
import { api, todayISO } from '../api';
import { useAppDispatch, useAppSelector } from './hooks';
import { fetchBacklog, fetchTasks } from './tasksSlice';
import {
  fetchStats,
  hydrateStatsFromCache,
  markBootstrapped,
} from './statsSlice';

/**
 * On authenticated shell mount: hydrate stats from session cache, then
 * prefetch today’s stats + tasks into Redux (and React Query) so Badges /
 * Schedule open without a cold loading wait.
 */
export function DataBootstrap({
  userId,
  timeZone,
}: {
  userId: string;
  timeZone?: string | null;
}) {
  const dispatch = useAppDispatch();
  const qc = useQueryClient();
  const bootstrappedFor = useAppSelector((s) => s.stats.bootstrappedFor);
  const ranKey = useRef<string | null>(null);

  useEffect(() => {
    const date = todayISO(timeZone);
    const key = `${userId}:${date}`;
    if (ranKey.current === key || bootstrappedFor === key) return;
    ranKey.current = key;

    dispatch(hydrateStatsFromCache(date));

    const cached = (
      typeof window !== 'undefined'
        ? (() => {
            try {
              const raw = sessionStorage.getItem(`tb.stats.v1.${date}`);
              return raw ? (JSON.parse(raw) as StatsOverviewDto) : null;
            } catch {
              return null;
            }
          })()
        : null
    );
    if (cached) {
      qc.setQueryData(['stats', date], cached);
    }

    // Prefetch schedule template in parallel with tasks/stats (non-blocking).
    void qc.prefetchQuery({
      queryKey: ['schedule'],
      queryFn: () => api.get('/api/schedule'),
      staleTime: 60_000,
    });

    void Promise.all([
      dispatch(fetchStats(date)).then((action) => {
        if (fetchStats.fulfilled.match(action)) {
          qc.setQueryData(['stats', date], action.payload.stats);
        }
      }),
      dispatch(fetchTasks(date)),
      dispatch(fetchBacklog()),
    ]).finally(() => {
      dispatch(markBootstrapped(key));
    });
  }, [userId, timeZone, dispatch, qc, bootstrappedFor]);

  return null;
}
