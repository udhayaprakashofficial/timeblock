import type { DayUtilizationDto, EodSheetDto, StatsOverviewDto, WeeklyReportDto } from "../shared-types/index.ts";
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../tasks/scheduler.service';
import { LocalDataStore } from '../auth/local-data.store';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
export declare class StatsService {
    private readonly prisma;
    private readonly scheduler;
    private readonly local;
    private readonly supabase;
    private readonly db;
    constructor(prisma: PrismaService, scheduler: SchedulerService, local: LocalDataStore, supabase: SupabaseRestService, db: DbBridgeService);
    overview(userId: string, dateStr: string): Promise<StatsOverviewDto>;
    utilization(userId: string, dateStr: string): Promise<DayUtilizationDto>;
    weeklyReport(userId: string, dateStr: string): Promise<WeeklyReportDto>;
    eodSheet(userId: string, dateStr: string): Promise<EodSheetDto>;
    private buildWeekly;
    private buildEod;
    private utilizationFromTasks;
    private counters;
    private asEffortTasks;
}
