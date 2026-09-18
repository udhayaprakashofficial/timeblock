import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(SessionAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  overview(
    @CurrentUserId() userId: string,
    @Query('date') date: string,
  ) {
    return this.statsService.overview(userId, date);
  }

  @Get('weekly')
  weekly(
    @CurrentUserId() userId: string,
    @Query('date') date: string,
  ) {
    return this.statsService.weeklyReport(userId, date);
  }

  @Get('eod')
  eod(
    @CurrentUserId() userId: string,
    @Query('date') date: string,
  ) {
    return this.statsService.eodSheet(userId, date);
  }
}
