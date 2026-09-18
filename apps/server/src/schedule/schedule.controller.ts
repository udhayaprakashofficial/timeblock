import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { UpsertScheduleTemplateDto } from '@timeblock/shared-types';
import { SessionAuthGuard } from '../auth/session.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ScheduleTemplatesService } from './schedule.service';

@Controller('schedule')
@UseGuards(SessionAuthGuard)
export class ScheduleTemplatesController {
  constructor(private readonly service: ScheduleTemplatesService) {}

  @Get()
  list(@CurrentUserId() userId: string) {
    return this.service.list(userId);
  }

  @Put()
  upsert(
    @CurrentUserId() userId: string,
    @Body() body: UpsertScheduleTemplateDto,
  ) {
    return this.service.upsert(userId, body);
  }

  @Put('apply-all')
  applyAll(
    @CurrentUserId() userId: string,
    @Body()
    body: {
      workStart: string;
      workEnd: string;
      breaks: Array<{ name: string; start: string; end: string }>;
    },
  ) {
    return this.service.applyToAllDays(userId, body);
  }
}
