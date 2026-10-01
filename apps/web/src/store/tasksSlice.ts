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
function sortDayTasks(list: TaskDto[] | null | undefined): TaskDto[] {
  const arr = Array.isArray(list) ? list : [];
  return [...arr].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.scheduledStart && b.scheduledStart) {
      return a.scheduledStart.localeCompare(b.scheduledStart);
    }
    if (a.scheduledStart) return -1;
    if (b.scheduledStart) return 1;
    return a.name.localeCompare(b.name);
  });
}

function asTaskList(value: unknown): TaskDto[] {
  return Array.isArray(value) ? (value as TaskDto[]) : [];
}

function asTask(value: unknown): TaskDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const t = value as TaskDto;
  return typeof t.id === 'string' ? t : null;
}

function upsertTask(list: TaskDto[], task: TaskDto): TaskDto[] {
  const base = asTaskList(list);
  const idx = base.findIndex((t) => t.id === task.id);
  if (idx < 0) return sortDayTasks([...base, task]);
  const next = base.slice();
  next[idx] = task;
  return sortDayTasks(next);
}

function removeTask(list: TaskDto[], taskId: string): TaskDto[] {
  return asTaskList(list).filter((t) => t.id !== taskId);
}

function pushPending(state: TasksState, key: string) {
  if (!state.pendingKeys.includes(key)) state.pendingKeys.push(key);
}

function popPending(state: TasksState, key: string) {
  state.pendingKeys = state.pendingKeys.filter((k) => k !== key);
}

function dayList(state: TasksState, date: string): TaskDto[] {
  if (!Array.isArray(state.byDate[date])) state.byDate[date] = [];
  return state.byDate[date];
}

/** Bank open-session seconds into actualMinutes (fractional OK for resume). */
function withBankedLiveSession(task: TaskDto, nowMs = Date.now()): TaskDto {
  if (!task.timerStartedAt || !task.activeEntryId) {
    return {
      ...task,
      activeEntryId: null,
      timerStartedAt: null,
    };
  }
  const started = Date.parse(task.timerStartedAt);
  const liveSec = Number.isFinite(started)
    ? Math.max(0, Math.floor((nowMs - started) / 1000))
    : 0;
  const base = Math.max(0, Number(task.actualMinutes) || 0);
  return {
    ...task,
    actualMinutes: base + liveSec / 60,
    activeEntryId: null,
    timerStartedAt: null,
    status: task.status === 'in_progress' ? 'pending' : task.status,
  };
}

function findTask(
  state: TasksState,
  taskId: string,
): { date: string; task: TaskDto } | null {
  for (const [date, list] of Object.entries(state.byDate)) {
    if (!Array.isArray(list)) continue;
    const task = list.find((t) => t.id === taskId);
    if (task) return { date, task };
  }
  const backlog = asTaskList(state.backlog).find((t) => t.id === taskId);
  if (backlog) return { date: backlog.date, task: backlog };
  return null;
}

function tempId() {
  return `temp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type CompleteStatus = 'completed' | 'pending';

/** Latest checkbox intent per task — wins over in-flight toggle responses. */
const completeIntentById = new Map<
  string,
  { epoch: number; status: CompleteStatus }
>();
const completeChainById = new Map<string, Promise<unknown>>();

/** Call before optimisticComplete + completeTaskOptimistic. */
export function beginCompleteIntent(
  taskId: string,
  status: CompleteStatus,
): number {
  const epoch = (completeIntentById.get(taskId)?.epoch ?? 0) + 1;
  completeIntentById.set(taskId, { epoch, status });
  return epoch;
}

function enqueueComplete<T>(taskId: string, run: () => Promise<T>): Promise<T> {
  const prev = completeChainById.get(taskId) ?? Promise.resolve();
  const next = prev.then(run, run);
  completeChainById.set(
    taskId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** Merge a server day snapshot without clobbering in-flight checkbox toggles. */
function mergeDayPreservingPendingCompletes(
  state: TasksState,
  date: string,
  serverTasks: TaskDto[] | null | undefined,
  opts?: { focusTaskId?: string; focusTask?: TaskDto },
) {
  const safeServer = asTaskList(serverTasks);
  const byId = new Map(safeServer.map((t) => [t.id, t] as const));
  if (opts?.focusTask) byId.set(opts.focusTask.id, opts.focusTask);
  const current = dayList(state, date);
  const merged = current.map((t) => {
    const server = byId.get(t.id);
    if (!server) return t;
    const keepOptimistic =
      t.id !== opts?.focusTaskId &&
      state.pendingKeys.includes(`complete:${t.id}`);
    if (keepOptimistic) {
      return {
        ...server,
        status: t.status,
        actualMinutes: t.actualMinutes,
        activeEntryId: t.activeEntryId,
        timerStartedAt: t.timerStartedAt,
        inBacklog: t.inBacklog,
      };
    }
    return { ...t, ...server };
  });
  for (const t of byId.values()) {
    if (!merged.some((m) => m.id === t.id) && !t.inBacklog) {
      merged.push(t);
    }
  }
  state.byDate[date] = sortDayTasks(merged);
}

/** Fetch day tasks — fills Redux cache. */
export const fetchTasks = createAsyncThunk(
  'tasks/fetchTasks',
  async (date: string) => {
    const tasks = await api.get<TaskDto[]>(`/api/tasks?date=${date}`);
    return { date, tasks: asTaskList(tasks) };
  },
);

export const fetchBacklog = createAsyncThunk('tasks/fetchBacklog', async () => {
  return asTaskList(await api.get<TaskDto[]>('/api/tasks/backlog'));
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
      overflowMode?: 'overtime' | 'reprioritize';
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
        ...(payload.overflowMode
          ? { overflowMode: payload.overflowMode }
          : {}),
      });
      // Only try a follow-up schedule when the create left it in backlog
      // without an explicit overflow mode or preferred slot (legacy path).
      if (
        task.inBacklog &&
        !payload.overflowMode &&
        !(payload.startTime && payload.endTime)
      ) {
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
  async (
    payload: {
      taskId: string;
      date: string;
      desiredStatus: CompleteStatus;
      epoch: number;
    },
    { rejectWithValue },
  ) => {
    try {
      return await enqueueComplete(payload.taskId, async () => {
        // Snapshot intent at job start. If a newer click lands mid-flight,
        // fulfilled ignores this response (epoch mismatch) and the next
        // queued job syncs to the latest intent.
        const intent = completeIntentById.get(payload.taskId);
        const desired = intent?.status ?? payload.desiredStatus;
        const epoch = intent?.epoch ?? payload.epoch;

        let task = await api.patch<TaskDto>(
          `/api/tasks/${payload.taskId}/complete`,
        );
        if (task.status !== desired) {
          task = await api.patch<TaskDto>(
            `/api/tasks/${payload.taskId}/complete`,
          );
        }

        return {
          date: payload.date,
          task,
          epoch,
        };
      });
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        taskId: payload.taskId,
        epoch: payload.epoch,
        desiredStatus: payload.desiredStatus,
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
      return { date: payload.date, task };
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
      return { date: payload.date, task };
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
      const tasks = asTaskList(
        await api.post<TaskDto[]>('/api/tasks/reorder', {
          date: payload.date,
          taskIds: payload.taskIds,
        }),
      );
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
      return { date: payload.date, task };
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
      const raw = await api.post<TaskDto>(
        `/api/tasks/${payload.taskId}/backlog`,
      );
      const task = asTask(raw);
      if (!task) {
        return rejectWithValue({
          date: payload.date,
          taskId: payload.taskId,
          message: 'Could not move',
        });
      }
      return { date: payload.date, task };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        taskId: payload.taskId,
        message: err instanceof Error ? err.message : 'Could not move',
      });
    }
  },
);

export const scheduleFromBacklogOptimistic = createAsyncThunk(
  'tasks/scheduleFromBacklog',
  async (payload: { taskId: string; date: string }, { rejectWithValue }) => {
    try {
      const raw = await api.post<TaskDto | TaskDto[]>(
        `/api/tasks/${payload.taskId}/schedule`,
        { date: payload.date },
      );
      // Server should return the placed task; tolerate a day-list response.
      const task = Array.isArray(raw)
        ? asTask(raw.find((t) => t.id === payload.taskId) ?? raw[0])
        : asTask(raw);
      if (!task) {
        return rejectWithValue({
          date: payload.date,
          taskId: payload.taskId,
          message: 'Could not schedule',
        });
      }
      return { date: payload.date, task };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        taskId: payload.taskId,
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
      return { date: payload.date, taskId: payload.taskId };
    } catch (err) {
      return rejectWithValue({
        date: payload.date,
        taskId: payload.taskId,
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
        scheduledStart: string | null;
        scheduledEnd: string | null;
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
      const taskId = action.payload.taskId;
      // Day list first
      for (const date of Object.keys(state.byDate)) {
        const list = dayList(state, date);
        const idx = list.findIndex((t) => t.id === taskId);
        if (idx < 0) continue;
        const t = list[idx];
        if (t.status === 'completed') {
          // Reopen: pending actual is timer-only. Estimate credit only while Done.
          // If actual equals estimate it was likely Done-without-timer — clear it.
          // Real timer totals that happen to match estimate are rare; server is source of truth.
          const keepTimer =
            t.actualMinutes > 0 && t.actualMinutes !== t.estimatedMinutes
              ? t.actualMinutes
              : 0;
          list[idx] = {
            ...t,
            status: 'pending',
            actualMinutes: keepTimer,
          };
        } else {
          const timerActual = Math.max(0, t.actualMinutes || 0);
          list[idx] = {
            ...t,
            status: 'completed',
            activeEntryId: null,
            timerStartedAt: null,
            // Done without timer → show assigned time as actual while completed
            actualMinutes:
              timerActual > 0
                ? timerActual
                : Math.max(1, t.estimatedMinutes || 30),
            inBacklog: false,
          };
        }
        state.byDate[date] = sortDayTasks(list);
        state.backlog = asTaskList(state.backlog).filter((b) => b.id !== taskId);
        pushPending(state, `complete:${taskId}`);
        return;
      }
      // Backlog → mark done and drop from backlog (lands on that day as completed)
      const backlogList = asTaskList(state.backlog);
      const bIdx = backlogList.findIndex((t) => t.id === taskId);
      if (bIdx < 0) return;
      const t = backlogList[bIdx]!;
      const timerActual = Math.max(0, t.actualMinutes || 0);
      const done: TaskDto = {
        ...t,
        status: 'completed',
        inBacklog: false,
        activeEntryId: null,
        timerStartedAt: null,
        actualMinutes:
          timerActual > 0
            ? timerActual
            : Math.max(1, t.estimatedMinutes || 30),
      };
      state.backlog = backlogList.filter((b) => b.id !== taskId);
      state.byDate[t.date] = sortDayTasks([
        ...dayList(state, t.date).filter((x) => x.id !== taskId),
        done,
      ]);
      pushPending(state, `complete:${taskId}`);
    },
    optimisticStart(state, action: PayloadAction<{ taskId: string }>) {
      const hit = findTask(state, action.payload.taskId);
      if (!hit) return;
      // Block if another task is already live — user must Pause first.
      for (const date of Object.keys(state.byDate)) {
        const list = state.byDate[date];
        if (!Array.isArray(list)) continue;
        const other = list.find(
          (t) => t.activeEntryId && t.id !== action.payload.taskId,
        );
        if (other) return;
      }
      const list = dayList(state, hit.date);
      const idx = list.findIndex((t) => t.id === hit.task.id);
      if (idx < 0) return;
      const t = list[idx]!;
      // Keep banked actualMinutes — resume continues from last pause.
      list[idx] = {
        ...t,
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
      // Fold live elapsed into actualMinutes so Pause/Start doesn't reset to 0.
      list[idx] = withBankedLiveSession(list[idx]!);
      state.byDate[hit.date] = sortDayTasks(list);
      pushPending(state, `stop:${hit.task.id}`);
    },
    optimisticReorder(
      state,
      action: PayloadAction<{ date: string; tasks: TaskDto[] }>,
    ) {
      state.byDate[action.payload.date] = asTaskList(action.payload.tasks).map(
        (t, i) => ({
          ...t,
          order: i,
        }),
      );
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
      state.backlog = asTaskList(state.backlog).filter(
        (t) => t.id !== action.payload.taskId,
      );
      pushPending(state, `remove:${action.payload.taskId}`);
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
      state.backlog = [
        moved,
        ...asTaskList(state.backlog).filter((t) => t.id !== moved.id),
      ];
      pushPending(state, `backlog:${hit.task.id}`);
    },
    optimisticRemoveFromBacklog(
      state,
      action: PayloadAction<{ taskId: string }>,
    ) {
      state.backlog = asTaskList(state.backlog).filter(
        (t) => t.id !== action.payload.taskId,
      );
      for (const date of Object.keys(state.byDate)) {
        state.byDate[date] = removeTask(dayList(state, date), action.payload.taskId);
      }
      pushPending(state, `remove:${action.payload.taskId}`);
    },
    optimisticScheduleFromBacklog(
      state,
      action: PayloadAction<{
        taskId: string;
        date: string;
        scheduledStart?: string | null;
        scheduledEnd?: string | null;
      }>,
    ) {
      const backlog = asTaskList(state.backlog);
      const task = backlog.find((t) => t.id === action.payload.taskId);
      if (!task) return;
      state.backlog = backlog.filter((t) => t.id !== task.id);
      const order = dayList(state, action.payload.date).length;
      const placed: TaskDto = {
        ...task,
        date: action.payload.date,
        inBacklog: false,
        order,
        status: task.status === 'completed' ? 'pending' : task.status,
        scheduledStart: action.payload.scheduledStart ?? task.scheduledStart,
        scheduledEnd: action.payload.scheduledEnd ?? task.scheduledEnd,
        scheduleLocked: false,
      };
      state.byDate[action.payload.date] = sortDayTasks([
        ...dayList(state, action.payload.date),
        placed,
      ]);
      pushPending(state, `schedule:${task.id}`);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTasks.pending, (state, action) => {
        state.loadingDate = action.meta.arg;
        state.error = null;
      })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        const incoming = asTaskList(action.payload?.tasks);
        const date = action.payload?.date;
        if (!date) {
          state.loadingDate = null;
          return;
        }
        // While a drag-reorder is in flight, don't let a parallel fetch
        // snap the queue back — UI stays on optimistic order.
        if (state.pendingKeys.includes(`reorder:${date}`)) {
          state.loadingDate = null;
          state.loadedDates[date] = true;
          return;
        }
        // Checkbox toggles in flight: keep optimistic checked state.
        if (state.pendingKeys.some((k) => k.startsWith('complete:'))) {
          mergeDayPreservingPendingCompletes(state, date, incoming);
          state.loadedDates[date] = true;
          state.loadingDate = null;
          return;
        }

        let next = sortDayTasks(incoming);
        // Keep optimistic creates that haven't reconciled yet.
        const pendingCreates = dayList(state, date).filter(
          (t) =>
            t.id.startsWith('temp_') &&
            state.pendingKeys.includes(`create:${t.id}`),
        );
        if (pendingCreates.length) {
          next = sortDayTasks([
            ...next.filter((t) => !pendingCreates.some((p) => p.id === t.id)),
            ...pendingCreates,
          ]);
        }
        // Keep tasks that were optimistically moved to backlog.
        const backlogPending = state.pendingKeys
          .filter((k) => k.startsWith('backlog:'))
          .map((k) => k.slice('backlog:'.length));
        if (backlogPending.length) {
          next = next.filter((t) => !backlogPending.includes(t.id));
        }
        // Keep tasks optimistically removed.
        const removePending = state.pendingKeys
          .filter((k) => k.startsWith('remove:'))
          .map((k) => k.slice('remove:'.length));
        if (removePending.length) {
          next = next.filter((t) => !removePending.includes(t.id));
        }

        state.byDate[date] = next;
        state.loadedDates[date] = true;
        state.loadingDate = null;
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state.loadingDate = null;
        state.error = action.error.message ?? 'Failed to load tasks';
      })
      .addCase(fetchBacklog.fulfilled, (state, action) => {
        let next = asTaskList(action.payload);
        // Preserve optimistic backlog rows still in flight.
        const pendingBacklogIds = state.pendingKeys
          .filter((k) => k.startsWith('backlog:'))
          .map((k) => k.slice('backlog:'.length));
        const localBacklog = asTaskList(state.backlog);
        for (const id of pendingBacklogIds) {
          const local = localBacklog.find((t) => t.id === id);
          if (local && !next.some((t) => t.id === id)) {
            next = [local, ...next];
          }
        }
        const removePending = state.pendingKeys
          .filter((k) => k.startsWith('remove:'))
          .map((k) => k.slice('remove:'.length));
        if (removePending.length) {
          next = next.filter((t) => !removePending.includes(t.id));
        }
        // Also drop tasks that were optimistically scheduled out of backlog.
        const schedulePending = state.pendingKeys
          .filter((k) => k.startsWith('schedule:'))
          .map((k) => k.slice('schedule:'.length));
        if (schedulePending.length) {
          next = next.filter((t) => !schedulePending.includes(t.id));
        }
        state.backlog = next;
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
            ...asTaskList(state.backlog).filter((t) => t.id !== task.id),
          ];
        } else {
          state.byDate[date] = sortDayTasks(upsertTask(withoutTemp, task));
          state.backlog = asTaskList(state.backlog).filter((t) => t.id !== task.id);
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
        const taskId = action.meta.arg.taskId;
        const latest = completeIntentById.get(taskId)?.epoch;
        // Older serialized response — a newer click owns the checkbox UI.
        if (latest != null && action.payload.epoch !== latest) {
          return;
        }
        popPending(state, `complete:${taskId}`);
        const date = action.payload.date;
        const intent = completeIntentById.get(taskId)?.status;
        const task = {
          ...action.payload.task,
          status: intent ?? action.payload.task.status,
        };
        state.byDate[date] = sortDayTasks(
          upsertTask(dayList(state, date), task),
        );
        if (task.status === 'completed') {
          state.backlog = asTaskList(state.backlog).filter((b) => b.id !== taskId);
        }
      })
      .addCase(completeTaskOptimistic.rejected, (state, action) => {
        const taskId = action.meta.arg.taskId;
        const payload = action.payload as
          | {
              date?: string;
              epoch?: number;
              desiredStatus?: CompleteStatus;
              message?: string;
            }
          | undefined;
        const latest = completeIntentById.get(taskId)?.epoch;
        if (
          latest != null &&
          payload?.epoch != null &&
          payload.epoch !== latest
        ) {
          return;
        }
        popPending(state, `complete:${taskId}`);
        // Revert to the opposite of what this click wanted.
        const date = action.meta.arg.date;
        const desired =
          payload?.desiredStatus ?? action.meta.arg.desiredStatus;
        const list = dayList(state, date);
        const idx = list.findIndex((t) => t.id === taskId);
        if (idx >= 0) {
          const t = list[idx]!;
          list[idx] = {
            ...t,
            status: desired === 'completed' ? 'pending' : 'completed',
          };
          state.byDate[date] = sortDayTasks(list);
        }
        state.error = payload?.message ?? 'Complete failed';
      })
      .addCase(startTimerOptimistic.fulfilled, (state, action) => {
        popPending(state, `start:${action.meta.arg.taskId}`);
        const server = action.payload.task;
        const current = dayList(state, action.payload.date).find(
          (t) => t.id === server.id,
        );
        // Prefer the higher banked total (optimistic pause may be ahead of server minutes).
        const merged: TaskDto = {
          ...server,
          actualMinutes: Math.max(
            Number(server.actualMinutes) || 0,
            Number(current?.actualMinutes) || 0,
          ),
        };
        state.byDate[action.payload.date] = sortDayTasks(
          upsertTask(dayList(state, action.payload.date), merged),
        );
      })
      .addCase(startTimerOptimistic.rejected, (state, action) => {
        const taskId = action.meta.arg.taskId;
        popPending(state, `start:${taskId}`);
        const date = action.meta.arg.date;
        const list = dayList(state, date);
        const idx = list.findIndex((t) => t.id === taskId);
        if (idx >= 0) {
          const t = list[idx]!;
          list[idx] = {
            ...t,
            activeEntryId: null,
            timerStartedAt: null,
            status: t.status === 'in_progress' ? 'pending' : t.status,
          };
          state.byDate[date] = sortDayTasks(list);
        }
        state.error =
          (action.payload as { message?: string } | undefined)?.message ??
          'Start failed';
      })
      .addCase(stopTimerOptimistic.fulfilled, (state, action) => {
        const taskId = action.meta.arg.taskId;
        popPending(state, `stop:${taskId}`);
        const server = action.payload.task;
        const current = dayList(state, action.payload.date).find(
          (t) => t.id === taskId,
        );
        // If the user already hit Start again, keep the live session and only
        // sync the banked total from the pause response.
        const resumed =
          Boolean(current?.activeEntryId) &&
          (state.pendingKeys.includes(`start:${taskId}`) ||
            String(current?.activeEntryId).startsWith('opt_') ||
            Boolean(current?.timerStartedAt));
        const merged: TaskDto = resumed
          ? {
              ...server,
              actualMinutes: Math.max(
                Number(server.actualMinutes) || 0,
                Number(current?.actualMinutes) || 0,
              ),
              activeEntryId: current!.activeEntryId,
              timerStartedAt: current!.timerStartedAt ?? server.timerStartedAt,
              status: 'in_progress',
            }
          : {
              ...server,
              actualMinutes: Math.max(
                Number(server.actualMinutes) || 0,
                Number(current?.actualMinutes) || 0,
              ),
            };
        state.byDate[action.payload.date] = sortDayTasks(
          upsertTask(dayList(state, action.payload.date), merged),
        );
      })
      .addCase(stopTimerOptimistic.rejected, (state, action) => {
        const taskId = action.meta.arg.taskId;
        popPending(state, `stop:${taskId}`);
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
        const serverTasks = asTaskList(action.payload.tasks);
        const current = dayList(state, date);
        const byId = new Map(serverTasks.map((t) => [t.id, t] as const));
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
        for (const t of serverTasks) {
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
          state.byDate[payload.date] = asTaskList(payload.previous).map(
            (t, i) => ({
              ...t,
              order: i,
            }),
          );
          state.error = payload.message;
        }
      })
      .addCase(updateTaskOptimistic.fulfilled, (state, action) => {
        state.byDate[action.payload.date] = sortDayTasks(
          upsertTask(dayList(state, action.payload.date), action.payload.task),
        );
      })
      .addCase(moveToBacklogOptimistic.fulfilled, (state, action) => {
        popPending(state, `backlog:${action.payload.task.id}`);
        const task = { ...action.payload.task, inBacklog: true };
        state.byDate[action.payload.date] = removeTask(
          dayList(state, action.payload.date),
          task.id,
        );
        state.backlog = [
          task,
          ...asTaskList(state.backlog).filter((t) => t.id !== task.id),
        ];
      })
      .addCase(moveToBacklogOptimistic.rejected, (state, action) => {
        const payload = action.payload as
          | { date?: string; taskId?: string; message?: string }
          | undefined;
        if (payload?.taskId) popPending(state, `backlog:${payload.taskId}`);
        state.error = payload?.message ?? 'Could not move';
        // Soft recovery: refetch is triggered by the page if needed.
      })
      .addCase(scheduleFromBacklogOptimistic.fulfilled, (state, action) => {
        popPending(state, `schedule:${action.meta.arg.taskId}`);
        const task = { ...action.payload.task, inBacklog: false };
        state.backlog = asTaskList(state.backlog).filter((t) => t.id !== task.id);
        state.byDate[action.payload.date] = sortDayTasks(
          upsertTask(dayList(state, action.payload.date), task),
        );
      })
      .addCase(scheduleFromBacklogOptimistic.rejected, (state, action) => {
        const payload = action.payload as
          | { date?: string; taskId?: string; message?: string }
          | undefined;
        popPending(state, `schedule:${action.meta.arg.taskId}`);
        state.error = payload?.message ?? 'Could not schedule';
      })
      .addCase(removeTaskOptimistic.fulfilled, (state, action) => {
        popPending(state, `remove:${action.payload.taskId}`);
        state.byDate[action.payload.date] = removeTask(
          dayList(state, action.payload.date),
          action.payload.taskId,
        );
        state.backlog = asTaskList(state.backlog).filter(
          (t) => t.id !== action.payload.taskId,
        );
      })
      .addCase(removeTaskOptimistic.rejected, (state, action) => {
        const payload = action.payload as
          | { date?: string; taskId?: string; message?: string }
          | undefined;
        if (payload?.taskId) popPending(state, `remove:${payload.taskId}`);
        state.error = payload?.message ?? 'Could not remove';
      });
  },
});

export const tasksActions = {
  ...tasksSlice.actions,
  tempId,
};

/** Instant checkbox + durable sync. Safe when clicking many tasks in a row. */
export function queueCompleteTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => any,
  args: { taskId: string; date: string; currentlyDone: boolean },
) {
  const desiredStatus: CompleteStatus = args.currentlyDone
    ? 'pending'
    : 'completed';
  const epoch = beginCompleteIntent(args.taskId, desiredStatus);
  dispatch(tasksActions.optimisticComplete({ taskId: args.taskId }));
  return dispatch(
    completeTaskOptimistic({
      taskId: args.taskId,
      date: args.date,
      desiredStatus,
      epoch,
    }),
  );
}

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
