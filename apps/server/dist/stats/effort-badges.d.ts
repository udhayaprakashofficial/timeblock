import type { EffortSummaryDto } from "../shared-types/index.ts";
type TaskLike = {
    date: string;
    name?: string;
    status: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
    scheduleLocked?: boolean;
};
/** Consecutive days (ending today or yesterday) with ≥1 completed task. */
export declare function computeStreakDays(tasks: TaskLike[], todayStr: string): number;
/**
 * Derive motivational effort badges from recent task history.
 * Pure — safe for Prisma, Supabase, and local store paths.
 */
export declare function buildEffortSummary(input: {
    date: string;
    todayTasks: TaskLike[];
    weekTasks: TaskLike[];
    /** Broader window (e.g. 14–30d) for streaks / learning consistency */
    recentTasks?: TaskLike[];
    utilizationPercent: number;
}): EffortSummaryDto;
export {};
