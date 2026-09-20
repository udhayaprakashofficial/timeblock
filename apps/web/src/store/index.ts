'use client';

import { configureStore } from '@reduxjs/toolkit';
import tasksReducer from './tasksSlice';
import statsReducer from './statsSlice';

export function makeStore() {
  return configureStore({
    reducer: {
      tasks: tasksReducer,
      stats: statsReducer,
    },
    middleware: (getDefault) =>
      getDefault({
        serializableCheck: false,
      }),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
