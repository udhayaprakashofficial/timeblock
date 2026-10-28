import { Module, forwardRef } from '@nestjs/common';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarController } from './calendar.controller';
import { CalendarFeedsStore } from './calendar-feeds.store';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [forwardRef(() => AuthModule), TasksModule],
  providers: [CalendarSyncService, CalendarFeedsStore],
  controllers: [CalendarController],
  exports: [CalendarSyncService],
})
export class CalendarModule {}
