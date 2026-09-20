'use client';

import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { StatsOverviewDto } from '@timeblock/shared-types';
import { api } from '../api';

const CACHE_PREFIX = 'tb.stats.v1.';

export type StatsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type StatsState = {
  byDate: Record<string, StatsOverviewDto>;
  statusByDate: Record<string, StatsStatus>;
  error: string | null;
  bootstrappedFor: string | null;
};

function readCache(date: string): StatsOverviewDto | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + date);
    if (!raw) return null;
    return JSON.parse(raw) as StatsOverviewDto;
  } catch {
    return null;
  }
}

function writeCache(date: string, stats: StatsOverviewDto) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CACHE_PREFIX + date, JSON.stringify(stats));
  } catch {
    /* quota / private mode */
  }
}

function hydrateInitial(): StatsState {
  const state: StatsState = {
    byDate: {},
    statusByDate: {},
    error: null,
    bootstrappedFor: null,
  };
  return state;
}

const initialState: StatsState = hydrateInitial();

/** Fetch stats overview (badges, utilization, counters) into Redux + session cache. */
export const fetchStats = createAsyncThunk(
  'stats/fetchStats',
  async (date: string) => {
    const stats = await api.get<StatsOverviewDto>(
      `/api/stats/overview?date=${date}`,
    );
    writeCache(date, stats);
    return { date, stats };
  },
);

const statsSlice = createSlice({
  name: 'stats',
  initialState,
  reducers: {
    /** Instant paint from sessionStorage before network. */
    hydrateStatsFromCache(state, action: PayloadAction<string>) {
      const date = action.payload;
      if (state.byDate[date]) return;
      const cached = readCache(date);
      if (cached) {
        state.byDate[date] = cached;
        state.statusByDate[date] = 'ready';
      }
    },
    setStats(
      state,
      action: PayloadAction<{ date: string; stats: StatsOverviewDto }>,
    ) {
      const { date, stats } = action.payload;
      state.byDate[date] = stats;
      state.statusByDate[date] = 'ready';
      state.error = null;
      writeCache(date, stats);
    },
    clearStats(state) {
      state.byDate = {};
      state.statusByDate = {};
      state.error = null;
      state.bootstrappedFor = null;
    },
    markBootstrapped(state, action: PayloadAction<string>) {
      state.bootstrappedFor = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchStats.pending, (state, action) => {
        const date = action.meta.arg;
        if (!state.byDate[date]) {
          state.statusByDate[date] = 'loading';
        }
        state.error = null;
      })
      .addCase(fetchStats.fulfilled, (state, action) => {
        const { date, stats } = action.payload;
        state.byDate[date] = stats;
        state.statusByDate[date] = 'ready';
        state.error = null;
      })
      .addCase(fetchStats.rejected, (state, action) => {
        const date = action.meta.arg;
        if (!state.byDate[date]) {
          state.statusByDate[date] = 'error';
        }
        state.error = action.error.message ?? 'Failed to load stats';
      });
  },
});

export const {
  hydrateStatsFromCache,
  setStats,
  clearStats,
  markBootstrapped,
} = statsSlice.actions;

export default statsSlice.reducer;
