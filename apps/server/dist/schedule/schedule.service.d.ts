import type { DailyScheduleTemplateDto, UpsertScheduleTemplateDto } from "../shared-types/index.ts";
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../tasks/scheduler.service';
import { LocalDataStore } from '../auth/local-data.store';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
export declare class ScheduleTemplatesService {
    private readonly prisma;
    private readonly scheduler;
    private readonly local;
    private readonly supabase;
    private readonly db;
    constructor(prisma: PrismaService, scheduler: SchedulerService, local: LocalDataStore, supabase: SupabaseRestService, db: DbBridgeService);
    private viaDb;
    private rescheduleAfter;
    list(userId: string): Promise<DailyScheduleTemplateDto[]>;
    upsert(userId: string, dto: UpsertScheduleTemplateDto): Promise<DailyScheduleTemplateDto>;
    applyToAllDays(userId: string, dto: Omit<UpsertScheduleTemplateDto, 'weekday'>): Promise<DailyScheduleTemplateDto[]>;
    private writeTemplate;
    private rescheduleUpcoming;
    private map;
}
