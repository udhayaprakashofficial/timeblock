import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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

  /** Create a 30-day shareable link for one work date. */
  @Post('eod/share')
  share(
    @CurrentUserId() userId: string,
    @Body() body: { date?: string },
  ) {
    return this.statsService.createTimesheetShare(
      userId,
      String(body?.date ?? ''),
    );
  }

  /** Email the shareable timesheet link via Brevo (no browser mail tab). */
  @Post('eod/share/email')
  emailShare(
    @CurrentUserId() userId: string,
    @Body() body: { date?: string; toEmail?: string },
  ) {
    return this.statsService.emailTimesheetShare(userId, body ?? {});
  }
}

/** Public timesheet view — no session required. */
@Controller('public/timesheet')
export class PublicTimesheetController {
  constructor(private readonly statsService: StatsService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.statsService.getSharedTimesheet(token);
  }
}
