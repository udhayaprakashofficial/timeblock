import { Module, forwardRef } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { SchedulerService } from './scheduler.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [TasksService, SchedulerService],
  controllers: [TasksController],
  exports: [TasksService, SchedulerService],
})
export class TasksModule {}
