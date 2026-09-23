'use client';

import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { TaskDto } from '@timeblock/shared-types';
import { api } from '../api';

export type TasksState = {
  byDate: Record<string, TaskDto[]>;
  backlog: TaskDto[];
  loadedDates: Record<string, boolean>;
  backlogLoaded: boolean;
  loadingDate: string | null;
  pendingKeys: string[];
  error: string | null;
  createError: string | null;
};

const initialState: TasksState = {
  byDate: {},
  backlog: [],
  loadedDates: {},
  backlogLoaded: false,
  loadingDate: null,
  pendingKeys: [],
  error: null,
  createError: null,
};

/** Day queue order is explicit priority (`order`), not wall-clock time. */
function sortDayTasks(list: TaskDto[]): TaskDto[] {
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

function upsertTask(list: TaskDto[], task: TaskDto): TaskDto[] {
  const idx = list.findIndex((t) => t.id === task.id);
  if (idx < 0) return sortDayTasks([...list, task]);
  const next = list.slice();
  next[idx] = task;
  return sortDayTasks(next);
}

function removeTask(list: TaskDto[], taskId: string): TaskDto[] {
  return list.filter((t) => t.id !== taskId);
}

function pushPending(state: TasksState, key: string) {
  if (!state.pendingKeys.includes(key)) state.pendingKeys.push(key);
}

function popPending(state: TasksState, key: string) {
  state.pendingKeys = state.pendingKeys.filter((k) => k !== key);
}

function dayList(state: TasksState, date: string): TaskDto[] {
  if (!state.byDate[date]) state.byDate[date] = [];
  return state.byDate[date];
}

function findTask(
  state: TasksState,
  taskId: string,
): { date: string; task: TaskDto } | null {
  for (const [date, list] of Object.entries(state.byDate)) {
    const task = list.find((t) => t.id === taskId);
    if (task) return { date, task };
  }
  const backlog = state.backlog.find((t) => t.id === taskId);
  if (backlog) return { date: backlog.date, task: backlog };
  return null;
}

function tempId() {
  return `temp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Fetch day tasks — fills Redux cache. */
export const fetchTasks = createAsyncThunk(
  'tasks/fetchTasks',
  async (date: string) => {
    const tasks = await api.get<TaskDto[]>(`/api/tasks?date=${date}`);
    return { date, tasks };
  },
);

export const fetchBacklog = createAsyncThunk('tasks/fetchBacklog', async () => {
  return api.get<TaskDto[]>('/api/tasks/backlog');
});

export const createTaskOptimistic = createAsyncThunk(
  'tasks/create',
  async (
    payload: {
      date: string;
      name: string;
      estimatedMinutes: number;
      startTime?: string;
      endTime?: string;
      tempId: string;
    },
    { rejectWithValue },
  ) => {
    try {
      let task = await api.post<TaskDto>('/api/tasks', {
        date: payload.date,
        name: payload.name,
        estimatedMinutes: payload.estimatedMinutes,
        ...(payload.startTime && payload.endTime
          ? { startTime: payload.startTime, endTime: payload.endTime }
          : {}),
      });
      if (task.inBacklog) {
        try {
          const placed = await api.post<TaskDto>(
            `/api/tasks/${task.id}/schedule`,
            { date: payload.date },
          );
          task = placed;
        } catch {
          /* keep backlog placement */
        }
      }
      // Return immediately — UI already has optimistic slot; reconcile later
      return { date: payload.date, tempId: payload.tempId, task };
    } catch (err) {
      return rejectWithValue({
        tempId: payload.tempId,
        date: payload.date,
        message: err instanceof Error ? err.message : 'Could not add task',
      });
    }
  },
);

export const completeTaskOptimistic = createAsyncThunk(
  'tasks/complete',
  async (payload: { taskId: string; date: string }, { rejectWithValue }) => {
    try {
      const task = await api.patch<TaskDto>(
        `/api/tasks/${payload.taskId}/complete`,
      );
      const tasks = await api.get<TaskDto[]>(
        `/api/tasks?date=${payload.date}`,
      );
      return { date: payload.date, task, tasks };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        message: err instanceof Error ? err.message : 'Could not complete',
      });
    }
  },
);

export const startTimerOptimistic = createAsyncThunk(
  'tasks/startTimer',
  async (payload: { taskId: string; date: string }, { rejectWithValue }) => {
    try {
      const task = await api.post<TaskDto>(
        `/api/timer/${payload.taskId}/start`,
      );
      const tasks = await api.get<TaskDto[]>(
        `/api/tasks?date=${payload.date}`,
      );
      return { date: payload.date, task, tasks };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        message: err instanceof Error ? err.message : 'Could not start timer',
      });
    }
  },
);

export const stopTimerOptimistic = createAsyncThunk(
  'tasks/stopTimer',
  async (payload: { taskId: string; date: string }, { rejectWithValue }) => {
    try {
      const task = await api.post<TaskDto>(`/api/timer/${payload.taskId}/stop`);
      const tasks = await api.get<TaskDto[]>(
        `/api/tasks?date=${payload.date}`,
      );
      return { date: payload.date, task, tasks };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        message: err instanceof Error ? err.message : 'Could not stop timer',
      });
    }
  },
);

export const reorderTasksOptimistic = createAsyncThunk(
  'tasks/reorder',
  async (
    payload: { date: string; taskIds: string[]; previous: TaskDto[] },
    { rejectWithValue },
  ) => {
    try {
      const tasks = await api.post<TaskDto[]>('/api/tasks/reorder', {
        date: payload.date,
        taskIds: payload.taskIds,
      });
      return { date: payload.date, tasks };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        previous: payload.previous,
        message: err instanceof Error ? err.message : 'Could not reorder',
      });
    }
  },
);

export const updateTaskOptimistic = createAsyncThunk(
  'tasks/update',
  async (
    payload: {
      taskId: string;
      date: string;
      body: {
        name?: string;
        notes?: string | null;
        estimatedMinutes?: number;
        startTime?: string;
        endTime?: string;
      };
    },
    { rejectWithValue },
  ) => {
    try {
      const task = await api.patch<TaskDto>(
        `/api/tasks/${payload.taskId}`,
        payload.body,
      );
      const tasks = await api.get<TaskDto[]>(
        `/api/tasks?date=${payload.date}`,
      );
      return { date: payload.date, task, tasks };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        message: err instanceof Error ? err.message : 'Could not update',
      });
    }
  },
);

export const moveToBacklogOptimistic = createAsyncThunk(
  'tasks/toBacklog',
  async (payload: { taskId: string; date: string }, { rejectWithValue }) => {
    try {
      const task = await api.post<TaskDto>(
        `/api/tasks/${payload.taskId}/backlog`,
      );
      const tasks = await api.get<TaskDto[]>(
        `/api/tasks?date=${payload.date}`,
      );
      const backlog = await api.get<TaskDto[]>('/api/tasks/backlog');
      return { date: payload.date, task, tasks, backlog };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        message: err instanceof Error ? err.message : 'Could not move',
      });
    }
  },
);

export const scheduleFromBacklogOptimistic = createAsyncThunk(
  'tasks/scheduleFromBacklog',
  async (payload: { taskId: string; date: string }, { rejectWithValue }) => {
    try {
      const task = await api.post<TaskDto>(
        `/api/tasks/${payload.taskId}/schedule`,
        { date: payload.date },
      );
      const tasks = await api.get<TaskDto[]>(
        `/api/tasks?date=${payload.date}`,
      );
      const backlog = await api.get<TaskDto[]>('/api/tasks/backlog');
      return { date: payload.date, task, tasks, backlog };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        message: err instanceof Error ? err.message : 'Could not schedule',
      });
    }
  },
);

export const removeTaskOptimistic = createAsyncThunk(
  'tasks/remove',
  async (payload: { taskId: string; date: string }, { rejectWithValue }) => {
    try {
      await api.delete(`/api/tasks/${payload.taskId}`);
      const tasks = await api.get<TaskDto[]>(
        `/api/tasks?date=${payload.date}`,
      );
      const backlog = await api.get<TaskDto[]>('/api/tasks/backlog');
      return { date: payload.date, taskId: payload.taskId, tasks, backlog };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        message: err instanceof Error ? err.message : 'Could not remove',
      });
    }
  },
);

const tasksSlice = createSlice({
  name: 'tasks',
  initialState,
  reducers: {
    clearCreateError(state) {
      state.createError = null;
    },
    optimisticCreate(
      state,
      action: PayloadAction<{
        tempId: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        scheduledStart: string;
        scheduledEnd: string;
        scheduleLocked?: boolean;
      }>,
    ) {
      const p = action.payload;
      const order = dayList(state, p.date).length;
      const optimistic: TaskDto = {
        id: p.tempId,
        date: p.date,
        name: p.name,
        estimatedMinutes: p.estimatedMinutes,
        status: 'pending',
        order,
        scheduledStart: p.scheduledStart,
        scheduledEnd: p.scheduledEnd,
        actualMinutes: 0,
        activeEntryId: null,
        scheduleLocked: Boolean(p.scheduleLocked),
        inBacklog: false,
        notes: null,
      };
      state.byDate[p.date] = sortDayTasks([
        ...dayList(state, p.date),
        optimistic,
      ]);
      state.createError = null;
      pushPending(state, `create:${p.tempId}`);
    },
    optimisticComplete(state, action: PayloadAction<{ taskId: string }>) {
      const hit = findTask(state, action.payload.taskId);
      if (!hit) return;
      const list = dayList(state, hit.date);
      const idx = list.findIndex((t) => t.id === hit.task.id);
      if (idx < 0) return;
      const t = list[idx];
      const actual =
        t.actualMinutes > 0
          ? t.actualMinutes
          : Math.max(1, t.estimatedMinutes || 30);
      list[idx] = {
        ...t,
        status: 'completed',
        activeEntryId: null,
        timerStartedAt: null,
        actualMinutes: actual,
        inBacklog: false,
      };
      state.byDate[hit.date] = sortDayTasks(list);
      pushPending(state, `complete:${hit.task.id}`);
    },
    optimisticStart(state, action: PayloadAction<{ taskId: string }>) {
      const hit = findTask(state, action.payload.taskId);
      if (!hit) return;
      // Pause any other live timers locally
      for (const date of Object.keys(state.byDate)) {
        state.byDate[date] = state.byDate[date].map((t) => {
          if (!t.activeEntryId) return t;
          if (t.id === action.payload.taskId) return t;
          return {
            ...t,
            activeEntryId: null,
            timerStartedAt: null,
            status: t.status === 'in_progress' ? 'pending' : t.status,
          };
        });
      }
      const list = dayList(state, hit.date);
      const idx = list.findIndex((t) => t.id === hit.task.id);
      if (idx < 0) return;
      list[idx] = {
        ...list[idx],
        activeEntryId: `opt_${Date.now()}`,
        timerStartedAt: new Date().toISOString(),
        status: 'in_progress',
      };
      state.byDate[hit.date] = sortDayTasks(list);
      pushPending(state, `start:${hit.task.id}`);
    },
    optimisticStop(state, action: PayloadAction<{ taskId: string }>) {
      const hit = findTask(state, action.payload.taskId);
      if (!hit) return;
      const list = dayList(state, hit.date);
      const idx = list.findIndex((t) => t.id === hit.task.id);
      if (idx < 0) return;
      const t = list[idx];
      list[idx] = {
        ...t,
        activeEntryId: null,
        timerStartedAt: null,
        status: t.status === 'in_progress' ? 'pending' : t.status,
      };
      state.byDate[hit.date] = sortDayTasks(list);
      pushPending(state, `stop:${hit.task.id}`);
    },
    optimisticReorder(
      state,
      action: PayloadAction<{ date: string; tasks: TaskDto[] }>,
    ) {
      state.byDate[action.payload.date] = action.payload.tasks.map((t, i) => ({
        ...t,
        order: i,
      }));
      pushPending(state, `reorder:${action.payload.date}`);
    },
    optimisticPatch(
      state,
      action: PayloadAction<{ taskId: string; patch: Partial<TaskDto> }>,
    ) {
      const hit = findTask(state, action.payload.taskId);
      if (!hit) return;
      const list = dayList(state, hit.date);
      const idx = list.findIndex((t) => t.id === hit.task.id);
      if (idx < 0) return;
      list[idx] = { ...list[idx], ...action.payload.patch };
      state.byDate[hit.date] = sortDayTasks(list);
    },
    optimisticRemoveFromDay(
      state,
      action: PayloadAction<{ taskId: string; date: string }>,
    ) {
      state.byDate[action.payload.date] = removeTask(
        dayList(state, action.payload.date),
        action.payload.taskId,
      );
    },
    optimisticToBacklog(state, action: PayloadAction<{ taskId: string }>) {
      const hit = findTask(state, action.payload.taskId);
      if (!hit) return;
      state.byDate[hit.date] = removeTask(
        dayList(state, hit.date),
        hit.task.id,
      );
      const moved: TaskDto = {
        ...hit.task,
        inBacklog: true,
        scheduledStart: null,
        scheduledEnd: null,
        scheduleLocked: false,
        activeEntryId: null,
        timerStartedAt: null,
      };
      state.backlog = [moved, ...state.backlog.filter((t) => t.id !== moved.id)];
    },
    optimisticScheduleFromBacklog(
      state,
      action: PayloadAction<{ taskId: string; date: string }>,
    ) {
      const task = state.backlog.find((t) => t.id === action.payload.taskId);
      if (!task) return;
      state.backlog = state.backlog.filter((t) => t.id !== task.id);
      const placed: TaskDto = {
        ...task,
        date: action.payload.date,
        inBacklog: false,
      };
      state.byDate[action.payload.date] = sortDayTasks([
        ...dayList(state, action.payload.date),
        placed,
      ]);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTasks.pending, (state, action) => {
        state.loadingDate = action.meta.arg;
        state.error = null;
      })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        // While a drag-reorder is in flight, don't let a parallel fetch
        // snap the queue back — UI stays on optimistic order.
        if (
          state.pendingKeys.includes(`reorder:${action.payload.date}`)
        ) {
          state.loadingDate = null;
          state.loadedDates[action.payload.date] = true;
          return;
        }
        state.byDate[action.payload.date] = sortDayTasks(action.payload.tasks);
        state.loadedDates[action.payload.date] = true;
        state.loadingDate = null;
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state.loadingDate = null;
        state.error = action.error.message ?? 'Failed to load tasks';
      })
      .addCase(fetchBacklog.fulfilled, (state, action) => {
        state.backlog = action.payload;
        state.backlogLoaded = true;
      })
      .addCase(createTaskOptimistic.fulfilled, (state, action) => {
        const { date, tempId, task } = action.payload;
        popPending(state, `create:${tempId}`);
        // Swap temp card for server task instantly (keep plan painted)
        const withoutTemp = removeTask(dayList(state, date), tempId);
        if (task.inBacklog) {
          state.byDate[date] = sortDayTasks(withoutTemp);
          state.backlog = [
            task,
            ...state.backlog.filter((t) => t.id !== task.id),
          ];
        } else {
          state.byDate[date] = sortDayTasks(upsertTask(withoutTemp, task));
          state.backlog = state.backlog.filter((t) => t.id !== task.id);
        }
        state.createError = null;
      })
      .addCase(createTaskOptimistic.rejected, (state, action) => {
        const payload = action.payload as
          | { tempId: string; date: string; message: string }
          | undefined;
        if (payload) {
          popPending(state, `create:${payload.tempId}`);
          state.byDate[payload.date] = removeTask(
            dayList(state, payload.date),
            payload.tempId,
          );
          state.createError = payload.message;
        }
      })
      .addCase(completeTaskOptimistic.fulfilled, (state, action) => {
        popPending(state, `complete:${action.meta.arg.taskId}`);
        state.byDate[action.payload.date] = sortDayTasks(action.payload.tasks);
      })
      .addCase(completeTaskOptimistic.rejected, (state, action) => {
        popPending(state, `complete:${action.meta.arg.taskId}`);
        // Soft recovery — leave optimistic state; caller may refetch
        state.error =
          (action.payload as { message?: string } | undefined)?.message ??
          'Complete failed';
      })
      .addCase(startTimerOptimistic.fulfilled, (state, action) => {
        popPending(state, `start:${action.meta.arg.taskId}`);
        state.byDate[action.payload.date] = sortDayTasks(action.payload.tasks);
      })
      .addCase(startTimerOptimistic.rejected, (state, action) => {
        popPending(state, `start:${action.meta.arg.taskId}`);
        state.error =
          (action.payload as { message?: string } | undefined)?.message ??
          'Start failed';
      })
      .addCase(stopTimerOptimistic.fulfilled, (state, action) => {
        popPending(state, `stop:${action.meta.arg.taskId}`);
        state.byDate[action.payload.date] = sortDayTasks(action.payload.tasks);
      })
      .addCase(stopTimerOptimistic.rejected, (state, action) => {
        popPending(state, `stop:${action.meta.arg.taskId}`);
        state.error =
          (action.payload as { message?: string } | undefined)?.message ??
          'Stop failed';
      })
      .addCase(reorderTasksOptimistic.fulfilled, (state, action) => {
        popPending(state, `reorder:${action.payload.date}`);
        // Keep the optimistic queue order; only refresh server fields
        // (scheduled times after re-pack, status, etc.). Full replace
        // waits for an explicit fetch/refresh.
        const date = action.payload.date;
        const current = dayList(state, date);
        const byId = new Map(
          action.payload.tasks.map((t) => [t.id, t] as const),
        );
        const merged = current.map((t, i) => {
          const server = byId.get(t.id);
          if (!server) return { ...t, order: i };
          return {
            ...t,
            ...server,
            // Preserve the order the user just dragged to
            order: i,
          };
        });
        // Append any tasks the server returned that we somehow missed
        for (const t of action.payload.tasks) {
          if (!merged.some((m) => m.id === t.id)) {
            merged.push({ ...t, order: merged.length });
          }
        }
        state.byDate[date] = merged;
      })
      .addCase(reorderTasksOptimistic.rejected, (state, action) => {
        const payload = action.payload as
          | { date: string; previous: TaskDto[]; message: string }
          | undefined;
        if (payload) {
          popPending(state, `reorder:${payload.date}`);
          state.byDate[payload.date] = payload.previous.map((t, i) => ({
            ...t,
            order: i,
          }));
          state.error = payload.message;
        }
      })
      .addCase(updateTaskOptimistic.fulfilled, (state, action) => {
        state.byDate[action.payload.date] = sortDayTasks(action.payload.tasks);
      })
      .addCase(moveToBacklogOptimistic.fulfilled, (state, action) => {
        state.byDate[action.payload.date] = sortDayTasks(action.payload.tasks);
        state.backlog = action.payload.backlog;
      })
      .addCase(scheduleFromBacklogOptimistic.fulfilled, (state, action) => {
        state.byDate[action.payload.date] = sortDayTasks(action.payload.tasks);
        state.backlog = action.payload.backlog;
      })
      .addCase(removeTaskOptimistic.fulfilled, (state, action) => {
        state.byDate[action.payload.date] = sortDayTasks(action.payload.tasks);
        state.backlog = action.payload.backlog;
      });
  },
});

export const tasksActions = {
  ...tasksSlice.actions,
  tempId,
};

export const selectTasksForDate = (date: string) => (state: { tasks: TasksState }) =>
  state.tasks.byDate[date] ?? [];

export const selectBacklog = (state: { tasks: TasksState }) => state.tasks.backlog;

export const selectTasksLoading = (date: string) => (state: { tasks: TasksState }) =>
  state.tasks.loadingDate === date && !state.tasks.loadedDates[date];

export const selectCreatePending = (state: { tasks: TasksState }) =>
  state.tasks.pendingKeys.some((k) => k.startsWith('create:'));

export const selectCreateError = (state: { tasks: TasksState }) =>
  state.tasks.createError;

export const selectTaskPending = (taskId: string) => (state: { tasks: TasksState }) =>
  state.tasks.pendingKeys.some((k) => k.endsWith(`:${taskId}`));

export default tasksSlice.reducer;
