import { Module, forwardRef } from '@nestjs/common';
import { StatsService } from './stats.service';
import {
  PublicTimesheetController,
  StatsController,
} from './stats.controller';
import { TasksModule } from '../tasks/tasks.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [
    TasksModule,
    forwardRef(() => AuthModule),
    MailModule,
    forwardRef(() => CalendarModule),
  ],
  providers: [StatsService],
  controllers: [StatsController, PublicTimesheetController],
})
export class StatsModule {}
