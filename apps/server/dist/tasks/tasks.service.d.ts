import type { CreateTaskDto, ScheduleBacklogTaskDto, TaskDto, UpdateTaskDto } from "../shared-types/index.ts";
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from './scheduler.service';
import { LocalDataStore } from '../auth/local-data.store';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
export declare class TasksService {
    private readonly prisma;
    private readonly scheduler;
    private readonly local;
    private readonly supabase;
    private readonly db;
    constructor(prisma: PrismaService, scheduler: SchedulerService, local: LocalDataStore, supabase: SupabaseRestService, db: DbBridgeService);
    private viaDb;
    private resolveTimeZone;
    private resolveDefaultMinutes;
    private resolveCreatePayload;
    /** Move unfinished non-meeting tasks from past days into the backlog. */
    carryOverUnfinished(userId: string): Promise<number>;
    list(userId: string, dateStr: string): Promise<TaskDto[]>;
    listBacklog(userId: string): Promise<TaskDto[]>;
    create(userId: string, dto: CreateTaskDto): Promise<TaskDto>;
    scheduleFromBacklog(userId: string, taskId: string, dto?: ScheduleBacklogTaskDto): Promise<TaskDto>;
    moveToBacklog(userId: string, taskId: string): Promise<TaskDto>;
    reorder(userId: string, dateStr: string, taskIds: string[]): Promise<TaskDto[]>;
    complete(userId: string, taskId: string): Promise<TaskDto>;
    remove(userId: string, taskId: string): Promise<{
        ok: boolean;
    }>;
    update(userId: string, taskId: string, dto: UpdateTaskDto): Promise<TaskDto>;
    private mapTask;
}
