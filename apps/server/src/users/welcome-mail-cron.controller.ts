import {
  All,
  Controller,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Vercel Cron + manual drain for pending founder welcome emails.
 * Auth: Authorization: Bearer $CRON_SECRET (or x-cron-secret).
 */
@Controller('internal/cron')
export class WelcomeMailCronController {
  constructor(private readonly users: UsersService) {}

  @All('welcome-emails')
  async drainWelcomeEmails(
    @Headers('authorization') authorization?: string,
    @Headers('x-cron-secret') cronHeader?: string,
  ) {
    this.assertCronAuth(authorization, cronHeader);
    const result = await this.users.drainPendingWelcomeEmails(30);
    return { ok: true, ...result, at: new Date().toISOString() };
  }

  private assertCronAuth(authorization?: string, cronHeader?: string) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      // Misconfigured deploy — refuse rather than leave an open drain.
      throw new UnauthorizedException('CRON_SECRET is not configured');
    }
    const bearer = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    const provided = (cronHeader?.trim() || bearer).trim();
    if (!provided || provided !== secret) {
      throw new UnauthorizedException('Invalid cron secret');
    }
  }
}
