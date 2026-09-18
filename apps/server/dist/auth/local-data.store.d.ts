import type { CreateTaskDto, DailyScheduleTemplateDto, StatsOverviewDto, TaskDto, UpsertScheduleTemplateDto, WeeklyReportDto } from '@timeblock/shared-types';
export declare class LocalDataStore {
    private readonly dir;
    private readonly file;
    private read;
    private write;
    ensureDefaultSchedule(userId: string): void;
    listSchedule(userId: string): DailyScheduleTemplateDto[];
    upsertSchedule(userId: string, dto: UpsertScheduleTemplateDto): DailyScheduleTemplateDto;
    applyScheduleToAll(userId: string, dto: Omit<UpsertScheduleTemplateDto, 'weekday'>): DailyScheduleTemplateDto[];
    listTasks(userId: string, dateStr: string): TaskDto[];
    listBacklog(userId: string): TaskDto[];
    carryOverUnfinished(userId: string, today: string): number;
    scheduleFromBacklog(userId: string, taskId: string, dateStr: string): TaskDto;
    createTask(userId: string, dto: CreateTaskDto & {
        scheduledStart?: Date | string | null;
        scheduledEnd?: Date | string | null;
        scheduleLocked?: boolean;
    }): TaskDto;
    reorderTasks(userId: string, dateStr: string, taskIds: string[]): TaskDto[];
    completeTask(userId: string, taskId: string): TaskDto;
    updateTask(userId: string, taskId: string, patch: {
        notes?: string | null;
        name?: string;
        estimatedMinutes?: number;
        startTime?: string | null;
        endTime?: string | null;
        unlockSchedule?: boolean;
        inBacklog?: boolean;
        date?: string;
        order?: number;
    }, timeZone?: string): TaskDto;
    removeTask(userId: string, taskId: string): {
        ok: boolean;
    };
    startTimer(userId: string, taskId: string): TaskDto;
    stopTimer(userId: string, taskId: string): TaskDto;
    overview(userId: string, dateStr: string): StatsOverviewDto;
    utilization(userId: string, dateStr: string): import("@timeblock/shared-types").DayUtilizationDto;
    weeklyReport(userId: string, dateStr: string): WeeklyReportDto;
    eodSheet(userId: string, dateStr: string): {
        date: string;
        generatedAt: string;
        summary: {
            total: number;
            completed: number;
            pending: number;
            inProgress: number;
            estimatedMinutes: number;
            actualMinutes: number;
            completionPercent: number;
        };
        tasks: {
            id: string;
            name: string;
            status: "pending" | "in_progress" | "completed";
            estimatedMinutes: number;
            actualMinutes: number;
            varianceMinutes: number;
            scheduledStart: string | null;
            scheduledEnd: string | null;
            scheduleLocked: boolean;
            meetLink: string | null;
            notes: string | null;
        }[];
        shipped: string[];
        remaining: string[];
    };
    private getAvailable;
    private rescheduleUpcoming;
    private rescheduleDay;
    private toDto;
}
