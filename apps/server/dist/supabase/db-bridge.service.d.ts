import { LocalUserStore } from '../auth/local-user.store';
import { LocalDataStore } from '../auth/local-data.store';
import { CryptoService } from '../crypto/crypto.service';
import { SupabaseRestService } from './supabase-rest.service';
/**
 * Routes app data to Supabase DB when keys are configured.
 * Maps offline `local_*` session users onto real User rows and migrates JSON data.
 */
export declare class DbBridgeService {
    private readonly supabase;
    private readonly localUsers;
    private readonly localData;
    private readonly crypto;
    private readonly logger;
    private readonly mapped;
    private readonly migrated;
    constructor(supabase: SupabaseRestService, localUsers: LocalUserStore, localData: LocalDataStore, crypto: CryptoService);
    /** True when APIs must use the database (HTTPS REST). */
    useDb(): boolean;
    /**
     * Resolve session userId to a Supabase User.id.
     * Migrates local file users + their tasks/schedules into the DB once.
     */
    resolveUserId(userId: string): Promise<string>;
    private migrateLocalData;
}
