import { Module, forwardRef } from '@nestjs/common';
import { ScheduleTemplatesService } from './schedule.service';
import { ScheduleTemplatesController } from './schedule.controller';
import { TasksModule } from '../tasks/tasks.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TasksModule, forwardRef(() => AuthModule)],
  providers: [ScheduleTemplatesService],
  controllers: [ScheduleTemplatesController],
  exports: [ScheduleTemplatesService],
})
export class ScheduleTemplatesModule {}
