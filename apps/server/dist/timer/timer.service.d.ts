import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { LocalDataStore } from '../auth/local-data.store';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
export declare class TimerService {
    private readonly prisma;
    private readonly tasksService;
    private readonly local;
    private readonly supabase;
    private readonly db;
    constructor(prisma: PrismaService, tasksService: TasksService, local: LocalDataStore, supabase: SupabaseRestService, db: DbBridgeService);
    start(userId: string, taskId: string): Promise<import("../shared-types").TaskDto | undefined>;
    stop(userId: string, taskId: string): Promise<import("../shared-types").TaskDto | undefined>;
    private stopOtherOpenTimersPrisma;
}
