import {
  BadRequestException,
  Body,
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

  @Get('feed')
  async feedStatus(@CurrentUserId() userId: string) {
    const id = await this.resolve(userId);
    return this.syncService.feedStatus(id);
  }

  @Post('feed')
  async saveFeed(
    @CurrentUserId() userId: string,
    @Body() body: { icsUrl?: string },
  ) {
    const id = await this.resolve(userId);
    const icsUrl = body.icsUrl?.trim() ?? '';
    if (!icsUrl) {
      throw new BadRequestException('Missing calendar feed URL');
    }
    try {
      return await this.syncService.saveFeed(id, icsUrl);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Could not connect calendar',
      );
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
