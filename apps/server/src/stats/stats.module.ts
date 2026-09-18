import { Module, forwardRef } from '@nestjs/common';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { TasksModule } from '../tasks/tasks.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TasksModule, forwardRef(() => AuthModule)],
  providers: [StatsService],
  controllers: [StatsController],
})
export class StatsModule {}
