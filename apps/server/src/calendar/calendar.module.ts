import { Module, forwardRef } from '@nestjs/common';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarController } from './calendar.controller';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [forwardRef(() => AuthModule), TasksModule],
  providers: [CalendarSyncService],
  controllers: [CalendarController],
  exports: [CalendarSyncService],
})
export class CalendarModule {}
