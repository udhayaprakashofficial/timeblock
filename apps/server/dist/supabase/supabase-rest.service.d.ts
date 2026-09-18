import { OnModuleInit } from '@nestjs/common';
type Json = Record<string, unknown>;
/**
 * Writes/reads app tables over Supabase PostgREST (HTTPS).
 * Used when the Prisma Postgres port is blocked but HTTPS works.
 */
export declare class SupabaseRestService implements OnModuleInit {
    private readonly logger;
    private ok;
    private get baseUrl();
    private get apiKey();
    isConfigured(): boolean;
    isReady(): boolean;
    onModuleInit(): Promise<void>;
    ping(): Promise<boolean>;
    private headers;
    private request;
    select<T extends Json = Json>(table: string, columns?: string, opts?: {
        filter?: string;
        limit?: number;
        order?: string;
    }): Promise<T[]>;
    insert<T extends Json = Json>(table: string, row: Json | Json[]): Promise<T[]>;
    upsert<T extends Json = Json>(table: string, row: Json | Json[], onConflict: string): Promise<T[]>;
    patch<T extends Json = Json>(table: string, filter: string, patch: Json): Promise<T[]>;
    delete(table: string, filter: string): Promise<void>;
    /** Upsert Google login into User + OAuthAccount over HTTPS. */
    upsertGoogleUser(input: {
        email: string;
        name: string;
        googleId: string;
        accessTokenEncrypted: string;
        refreshTokenEncrypted?: string | null;
    }): Promise<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
    }>;
    getUserByEmail(email: string): Promise<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
        passwordHash: string | null;
    }>;
    getUserById(id: string): Promise<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
    }>;
    createPasswordUser(input: {
        email: string;
        name: string;
        passwordHash: string;
    }): Promise<{
        id: string;
        name: string;
        email: string;
        theme: string;
        timezone: string;
    }>;
    listCalendarEvents(userId: string, dateStr: string, timeZone?: string | null): Promise<{
        id: string;
        provider: string;
        externalId: string;
        title: string;
        start: string;
        end: string;
        meetLink: string | null;
    }[]>;
    upsertCalendarEvent(row: {
        userId: string;
        provider: string;
        externalId: string;
        title: string;
        start: string;
        end: string;
        meetLink?: string | null;
    }): Promise<string>;
    getOAuthAccount(userId: string, provider: string): Promise<{
        id: string;
        accessTokenEncrypted: string;
        refreshTokenEncrypted: string | null;
        expiresAt: string | null;
    }>;
    listOAuthAccounts(userId?: string): Promise<{
        id: string;
        userId: string;
        provider: string;
        accessTokenEncrypted: string;
        refreshTokenEncrypted: string | null;
    }[]>;
    listOAuthProviders(userId: string): Promise<string[]>;
    /** One-shot: push apps/server/data/local-users.json into User + OAuthAccount. */
    private syncing;
    private syncLocalUsersIfPresent;
    listTasks(userId: string, dateStr: string): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    }[]>;
    listBacklogTasks(userId: string): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    }[]>;
    carryOverUnfinished(userId: string, today: string): Promise<number>;
    scheduleFromBacklog(userId: string, taskId: string, dateStr: string): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    }>;
    createTask(userId: string, dto: {
        date: string;
        name: string;
        estimatedMinutes: number;
        scheduledStart?: string | null;
        scheduledEnd?: string | null;
        scheduleLocked?: boolean;
        inBacklog?: boolean;
    }): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    }>;
    updateTaskNotes(userId: string, taskId: string, notes: string | null): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    }>;
    updateTask(userId: string, taskId: string, dto: {
        name?: string;
        notes?: string | null;
        estimatedMinutes?: number;
        startTime?: string | null;
        endTime?: string | null;
        unlockSchedule?: boolean;
        inBacklog?: boolean;
        date?: string;
        order?: number;
    }, timeZone: string): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    }>;
    completeTask(userId: string, taskId: string): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    }>;
    deleteTask(userId: string, taskId: string): Promise<void>;
    listSchedule(userId: string): Promise<{
        id: string;
        weekday: number;
        workStart: string;
        workEnd: string;
        breaks: {
            id: string;
            name: string;
            start: string;
            end: string;
        }[];
    }[]>;
    upsertSchedule(userId: string, dto: {
        weekday: number;
        workStart: string;
        workEnd: string;
        breaks: Array<{
            name: string;
            start: string;
            end: string;
        }>;
    }): Promise<{
        id: string;
        weekday: number;
        workStart: string;
        workEnd: string;
        breaks: {
            id: string;
            name: string;
            start: string;
            end: string;
        }[];
    }>;
    startTimer(userId: string, taskId: string): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    } | undefined>;
    stopTimer(userId: string, taskId: string): Promise<{
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    } | undefined>;
    /** Close open TimeEntries for a task (used by complete). */
    private closeOpenEntriesForTask;
    /** Stop every other open timer for this user so only one task can be Live. */
    private stopOtherOpenTimers;
    listTasksInRange(userId: string, from: string, to: string): Promise<{
        _entries: Record<string, unknown>[];
        id: string;
        date: string;
        name: string;
        estimatedMinutes: number;
        status: "pending" | "in_progress" | "completed";
        order: number;
        scheduledStart: string | null;
        scheduledEnd: string | null;
        actualMinutes: number;
        activeEntryId: string | null;
        meetLink: string | null;
        scheduleLocked: boolean;
        sourceProvider: string | null;
        notes: string | null;
        inBacklog: boolean;
    }[]>;
    private mapTaskRow;
}
export {};
