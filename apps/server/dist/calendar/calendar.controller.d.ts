import { CalendarSyncService } from './calendar-sync.service';
import { DbBridgeService } from '../supabase/db-bridge.service';
export declare class CalendarController {
    private readonly syncService;
    private readonly db;
    constructor(syncService: CalendarSyncService, db: DbBridgeService);
    private resolve;
    events(userId: string, date: string): Promise<{
        id: string;
        provider: string;
        externalId: string;
        title: string;
        start: string;
        end: string;
        meetLink: string | null;
    }[]>;
    sync(userId: string): Promise<{
        warning?: string | undefined;
        synced: string[];
    }>;
}
