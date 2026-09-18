import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { CalendarSyncService } from './calendar-sync.service';
import { DbBridgeService } from '../supabase/db-bridge.service';

@Controller('calendar')
@UseGuards(SessionAuthGuard)
export class CalendarController {
  constructor(
    private readonly syncService: CalendarSyncService,
    private readonly db: DbBridgeService,
  ) {}

  private async resolve(userId: string) {
    if (!this.db.useDb()) return userId;
    try {
      return await this.db.resolveUserId(userId);
    } catch {
      return userId;
    }
  }

  @Get('events')
  async events(
    @CurrentUserId() userId: string,
    @Query('date') date: string,
  ) {
    const id = await this.resolve(userId);
    try {
      return await this.syncService.listEvents(id, date);
    } catch {
      return [];
    }
  }

  @Post('sync')
  async sync(@CurrentUserId() userId: string) {
    const id = await this.resolve(userId);
    try {
      return await this.syncService.syncNow(id);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Calendar sync failed',
      );
    }
  }
}
