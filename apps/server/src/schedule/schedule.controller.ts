import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import type { UpsertScheduleTemplateDto, Weekday } from '@timeblock/shared-types';
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
      weekdays?: number[];
    },
  ) {
    const weekdays = (Array.isArray(body.weekdays) ? body.weekdays : [])
      .map((d) => Number(d))
      .filter((d) => d >= 0 && d <= 6) as Weekday[];
    return this.service.applyToDays(userId, {
      workStart: body.workStart,
      workEnd: body.workEnd,
      breaks: body.breaks ?? [],
      weekdays: weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6],
    });
  }

  @Delete(':weekday')
  remove(
    @CurrentUserId() userId: string,
    @Param('weekday') weekdayRaw: string,
  ) {
    const weekday = Number(weekdayRaw) as Weekday;
    return this.service.removeDay(userId, weekday);
  }
}
