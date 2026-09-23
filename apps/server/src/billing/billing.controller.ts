import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionAuthGuard } from '../auth/session.guard';
import { BillingService } from './billing.service';
import { UsersService } from '../users/users.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly users: UsersService,
  ) {}

  /** Public status — what the frontend needs without secrets. */
  @Get('config')
  config() {
    return {
      proProductId: this.billing.proProductId(),
      checkoutReady: true,
      apiKeyConfigured: this.billing.apiKeyConfigured(),
      webhookConfigured: this.billing.webhookConfigured(),
    };
  }

  /** Current plan + invoices for the signed-in user. */
  @Get('summary')
  @UseGuards(SessionAuthGuard)
  async summary(@Req() req: Request) {
    const userId = req.session!.userId!;
    let me = await this.users.getMe(userId);
    let profile = await this.billing.getBillingProfile(userId);
    let plan: 'free' | 'pro' =
      me.plan === 'pro' || profile.plan === 'pro' ? 'pro' : 'free';

    // Paid in Dodo but redirect/webhook missed → heal on summary load
    if (plan === 'free' && this.billing.apiKeyConfigured()) {
      try {
        const synced = await this.billing.syncPaidPlanFromDodo({
          userId: me.id,
          email: me.email,
        });
        if (synced.synced) {
          me = await this.users.getMe(userId);
          profile = await this.billing.getBillingProfile(userId);
          plan = 'pro';
        }
      } catch {
        /* leave as free — user can still Upgrade */
      }
    }

    const planStatus =
      me.planStatus ??
      profile.planStatus ??
      (plan === 'pro' ? 'pending_activation' : null);
    const activatedAt =
      me.proActivatedAt ?? profile.proActivatedAt ?? null;
    const paidAt = me.proPaidAt ?? profile.proPaidAt ?? null;
    const isActive =
      plan === 'pro' && planStatus === 'active' && Boolean(activatedAt);
    const isPending = plan === 'pro' && !isActive;

    let periodEnd: string | null = null;
    let daysRemaining: number | null = null;
    if (isActive && activatedAt) {
      const start = new Date(activatedAt);
      const end = new Date(start);
      end.setDate(end.getDate() + 30);
      periodEnd = end.toISOString();
      daysRemaining = Math.max(
        0,
        Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      );
    }

    const invoicePack =
      plan === 'pro'
        ? await this.billing.listInvoices(userId)
        : { invoicesAvailable: true, invoices: [] };

    return {
      plan,
      planLabel: plan === 'pro' ? 'Pro' : 'Free',
      status: planStatus || (plan === 'pro' ? 'pending_activation' : 'none'),
      statusLabel: this.billing.statusLabel(plan, planStatus),
      since: paidAt ?? me.planUpdatedAt ?? profile.planUpdatedAt,
      paidAt,
      activatedAt,
      periodEnd,
      daysRemaining,
      isPending,
      isActive,
      invoices: invoicePack.invoices,
      invoicesAvailable: invoicePack.invoicesAvailable,
      webhookConfigured: this.billing.webhookConfigured(),
      apiKeyConfigured: this.billing.apiKeyConfigured(),
    };
  }

  /**
   * Called when the browser returns from Dodo checkout
   * (?status=succeeded&payment_id=pay_… or ?status=active&subscription_id=sub_…).
   * Verifies with Dodo when DODO_PAYMENTS_API_KEY is set.
   * Webhooks still recommended for renewals / missed redirects.
   */
  @Post('confirm')
  @UseGuards(SessionAuthGuard)
  async confirm(
    @Req() req: Request,
    @Body()
    body: {
      paymentId?: string;
      subscriptionId?: string;
      status?: string;
    },
  ) {
    const userId = req.session!.userId!;
    const me = await this.users.getMe(userId);
    const profile = await this.billing.getBillingProfile(userId);
    const paymentId = body.paymentId?.trim() || '';
    const subscriptionId = body.subscriptionId?.trim() || '';
    // Already Pro with this payment/subscription — no-op.
    if (
      me.plan === 'pro' &&
      ((paymentId && profile.dodoPaymentId === paymentId) ||
        (subscriptionId && profile.dodoSubscriptionId === subscriptionId))
    ) {
      return {
        ok: true,
        plan: 'pro' as const,
        alreadyPro: true,
        verified: true,
        user: me,
      };
    }
    if (me.plan === 'pro' && !paymentId && !subscriptionId) {
      return {
        ok: true,
        plan: 'pro' as const,
        alreadyPro: true,
        verified: Boolean(
          profile.dodoPaymentId || profile.dodoSubscriptionId,
        ),
        user: me,
      };
    }
    const result = await this.billing.confirmCheckoutReturn({
      userId: me.id,
      email: me.email,
      paymentId: body.paymentId,
      subscriptionId: body.subscriptionId,
      status: body.status,
    });
    const updated = await this.users.getMe(userId);
    return { ...result, user: updated, alreadyPro: false };
  }

  /** Stream invoice PDF for a payment the user owns. */
  @Get('invoices/:paymentId')
  @UseGuards(SessionAuthGuard)
  async invoicePdf(
    @Req() req: Request,
    @Res() res: Response,
    @Param('paymentId') paymentId: string,
  ) {
    const userId = req.session!.userId!;
    try {
      const pdf = await this.billing.downloadInvoicePdf(userId, paymentId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cupkey-invoice-${paymentId}.pdf"`,
      );
      return res.send(pdf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invoice download failed';
      return res.status(400).json({ error: msg });
    }
  }

  @Post('checkout')
  @UseGuards(SessionAuthGuard)
  async checkout(@Req() req: Request) {
    const userId = req.session!.userId!;
    const me = await this.users.getMe(userId);
    if (me.plan === 'pro') {
      return { checkoutUrl: null, alreadyPro: true };
    }
    const result = await this.billing.createCheckout({
      userId: me.id,
      email: me.email,
      name: me.name,
    });
    return { ...result, alreadyPro: false };
  }

  /**
   * Pull latest succeeded Dodo payment for this account (by email / metadata)
   * and mark Pro. Fixes missed redirects when DODO_PAYMENTS_API_KEY is set.
   */
  @Post('sync')
  @UseGuards(SessionAuthGuard)
  async sync(@Req() req: Request) {
    const userId = req.session!.userId!;
    const me = await this.users.getMe(userId);
    const result = await this.billing.syncPaidPlanFromDodo({
      userId: me.id,
      email: me.email,
    });
    const updated = await this.users.getMe(userId);
    return { ...result, user: updated };
  }

  /**
   * Dodo webhook URL (production):
   *   https://app.cupkey.io/webhook
   *   https://app.cupkey.io/api/billing/webhook
   *   https://timeblock-server.vercel.app/api/billing/webhook
   */
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Headers('webhook-id') webhookId?: string,
    @Headers('webhook-signature') webhookSignature?: string,
    @Headers('webhook-timestamp') webhookTimestamp?: string,
  ) {
    const raw =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : Buffer.isBuffer(req.rawBody)
          ? req.rawBody.toString('utf8')
          : typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body ?? {});

    this.billing.verifyWebhook(raw, {
      'webhook-id': webhookId,
      'webhook-signature': webhookSignature,
      'webhook-timestamp': webhookTimestamp,
    });

    const payload =
      typeof req.body === 'object' && req.body
        ? (req.body as { type?: string; data?: Record<string, unknown> })
        : (JSON.parse(raw) as {
            type?: string;
            data?: Record<string, unknown>;
          });

    await this.billing.handleWebhookEvent(payload);
    return res.status(200).json({ received: true });
  }
}
