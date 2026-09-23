import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { ScheduleTemplatesModule } from '../schedule/schedule.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => TasksModule),
    ScheduleTemplatesModule,
    MailModule,
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
