import { Module, forwardRef } from '@nestjs/common';
import { TimerService } from './timer.service';
import { TimerController } from './timer.controller';
import { TasksModule } from '../tasks/tasks.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TasksModule, forwardRef(() => AuthModule)],
  providers: [TimerService],
  controllers: [TimerController],
})
export class TimerModule {}
