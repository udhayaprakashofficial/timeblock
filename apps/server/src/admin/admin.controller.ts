import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session.guard';
import { AdminGuard, ADMIN_EMAIL } from './admin.guard';
import { BillingService } from '../billing/billing.service';
import { BrevoMailService } from '../mail/brevo-mail.service';

@Controller('admin')
@UseGuards(SessionAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly billing: BillingService,
    private readonly mail: BrevoMailService,
  ) {}

  @Get('me')
  me() {
    return { ok: true, adminEmail: ADMIN_EMAIL };
  }

  /** Everyone who paid for Pro. */
  @Get('pro-payers')
  async proPayers() {
    const rows = await this.billing.listProPayers();
    return {
      payers: rows,
      pendingCount: rows.filter(
        (r) => r.planStatus !== 'active' || !r.proActivatedAt,
      ).length,
      activeCount: rows.filter(
        (r) => r.planStatus === 'active' && r.proActivatedAt,
      ).length,
    };
  }

  /**
   * Activate Pro for all pending payers (or a single userId).
   * Sends activation email to each; subscription countdown starts today.
   */
  @Post('activate-pro')
  async activatePro(
    @Body() body: { userId?: string; allPending?: boolean },
  ) {
    const target =
      body.allPending || !body.userId
        ? ('all_pending' as const)
        : [body.userId];
    const { activated } = await this.billing.activateProUsers(target);
    const activatedAt = new Date();
    let emailsSent = 0;
    for (const u of activated) {
      const ok = await this.mail.sendProActivatedEmail({
        toEmail: u.email,
        toName: u.name,
        activatedAt,
      });
      if (ok) emailsSent += 1;
    }
    return {
      ok: true,
      activatedCount: activated.length,
      emailsSent,
      activated,
      activatedAt: activatedAt.toISOString(),
    };
  }
}
