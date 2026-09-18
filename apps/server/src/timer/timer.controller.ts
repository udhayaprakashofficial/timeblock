import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { TimerService } from './timer.service';

@Controller('timer')
@UseGuards(SessionAuthGuard)
export class TimerController {
  constructor(private readonly timerService: TimerService) {}

  @Post(':taskId/start')
  start(@CurrentUserId() userId: string, @Param('taskId') taskId: string) {
    return this.timerService.start(userId, taskId);
  }

  @Post(':taskId/stop')
  stop(@CurrentUserId() userId: string, @Param('taskId') taskId: string) {
    return this.timerService.stop(userId, taskId);
  }
}
