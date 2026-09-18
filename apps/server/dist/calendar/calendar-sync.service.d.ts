import { CalendarProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SchedulerService } from '../tasks/scheduler.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
export declare class CalendarSyncService {
    private readonly prisma;
    private readonly authService;
    private readonly scheduler;
    private readonly supabase;
    private readonly logger;
    constructor(prisma: PrismaService, authService: AuthService, scheduler: SchedulerService, supabase: SupabaseRestService);
    pollAllUsers(): Promise<void>;
    private resolveTimeZone;
    syncUserProvider(userId: string, provider: CalendarProvider): Promise<void>;
    syncNow(userId: string): Promise<{
        warning?: string | undefined;
        synced: string[];
    }>;
    listEvents(userId: string, dateStr: string): Promise<{
        id: string;
        provider: string;
        externalId: string;
        title: string;
        start: string;
        end: string;
        meetLink: string | null;
    }[]>;
    private saveEvent;
    /** Turn each calendar event into a fixed task (Google Meet / Outlook calls). */
    private upsertCalendarTask;
    private getGoogleClient;
    private syncGoogle;
    private syncMicrosoft;
    private purgeMissingEvents;
    private refreshMicrosoft;
}
