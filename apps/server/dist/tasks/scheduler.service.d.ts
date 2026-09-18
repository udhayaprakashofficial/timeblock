import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { type Interval } from '../common/time.util';
type PackableTask = {
    id: string;
    estimatedMinutes: number;
    status: string;
    scheduledStart?: string | Date | null;
    scheduledEnd?: string | Date | null;
    scheduleLocked?: boolean;
};
/** Pure packer: place unlocked tasks into contiguous free slots; keep locked Meet/calendar tasks fixed. */
export declare function packTasks(tasks: PackableTask[], intervals: Interval[], day: Date | string, timeZone?: string | null): Array<{
    id: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
}>;
export declare class SchedulerService {
    private readonly prisma;
    private readonly supabase?;
    private readonly logger;
    constructor(prisma: PrismaService, supabase?: SupabaseRestService | undefined);
    private resolveTimeZone;
    getAvailableIntervals(userId: string, dateStr: string): Promise<{
        intervals: Interval[];
        availableMinutes: number;
    }>;
    rescheduleDay(userId: string, dateStr: string): Promise<void>;
    /** Force REST packing (used after REST task create/reorder). */
    rescheduleDayPreferRest(userId: string, dateStr: string): Promise<void>;
    private getAvailablePrisma;
    private getAvailableRest;
    private reschedulePrisma;
    private rescheduleRest;
}
export {};
