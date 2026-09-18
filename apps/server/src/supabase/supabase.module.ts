import { Module, Global } from '@nestjs/common';
import { SupabaseRestService } from './supabase-rest.service';
import { DbBridgeService } from './db-bridge.service';
import { LocalUserStore } from '../auth/local-user.store';
import { LocalDataStore } from '../auth/local-data.store';

@Global()
@Module({
  providers: [
    SupabaseRestService,
    DbBridgeService,
    // Same file-backed stores as AuthModule (shared JSON paths)
    LocalUserStore,
    LocalDataStore,
  ],
  exports: [SupabaseRestService, DbBridgeService],
})
export class SupabaseModule {}
