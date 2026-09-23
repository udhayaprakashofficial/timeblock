import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { LocalUserStore } from '../auth/local-user.store';

export const DODO_PRO_PRODUCT_ID =
  process.env.DODO_PRO_PRODUCT_ID?.trim() || 'pdt_0NoD66xtWburRIUH8s6AY';

const DEFAULT_CHECKOUT_BASE = 'https://test.checkout.dodopayments.com/buy';

type PlanPatch = {
  plan: 'free' | 'pro';
  planStatus?: string | null;
  dodoCustomerId?: string | null;
  dodoSubscriptionId?: string | null;
  dodoPaymentId?: string | null;
  proPaidAt?: Date | string | null;
  proActivatedAt?: Date | string | null;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseRestService,
    private readonly localUsers: LocalUserStore,
  ) {}

  proProductId() {
    return DODO_PRO_PRODUCT_ID;
  }

  apiKeyConfigured() {
    return Boolean(process.env.DODO_PAYMENTS_API_KEY?.trim());
  }

  webhookConfigured() {
    return Boolean(process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim());
  }

  private checkoutBase() {
    return (
      process.env.DODO_CHECKOUT_BASE?.trim() || DEFAULT_CHECKOUT_BASE
    ).replace(/\/$/, '');
  }

  private apiBase() {
    const env = (process.env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode').trim();
    return env === 'live_mode'
      ? 'https://live.dodopayments.com'
      : 'https://test.dodopayments.com';
  }

  private appPublicUrl() {
    return (
      process.env.APP_PUBLIC_URL?.trim() || 'https://app.cupkey.io'
    ).replace(/\/$/, '');
  }

  /** Static payment link (works without API key). */
  buildStaticCheckoutUrl(input: {
    userId?: string;
    email?: string;
    name?: string;
    redirectUrl?: string;
  }): string {
    const url = new URL(`${this.checkoutBase()}/${this.proProductId()}`);
    url.searchParams.set('quantity', '1');
    const defaultRedirect = input.userId?.trim()
      ? `${this.appPublicUrl()}/subscription`
      : `${this.appPublicUrl()}/pricing`;
    url.searchParams.set(
      'redirect_url',
      input.redirectUrl || defaultRedirect,
    );
    if (input.email?.trim()) {
      url.searchParams.set('email', input.email.trim());
      url.searchParams.set('disableEmail', 'true');
    }
    if (input.name?.trim()) {
      url.searchParams.set('fullName', input.name.trim());
    }
    if (input.userId?.trim()) {
      url.searchParams.set('metadata_userId', input.userId.trim());
    }
    return url.toString();
  }

  /**
   * Prefer Checkout Sessions when API key is set; else static link.
   * @see https://docs.dodopayments.com/developer-resources/subscription-integration-guide
   */
  async createCheckout(input: {
    userId: string;
    email: string;
    name: string;
  }): Promise<{ checkoutUrl: string; mode: 'session' | 'static' }> {
    const staticUrl = this.buildStaticCheckoutUrl(input);
    const apiKey = process.env.DODO_PAYMENTS_API_KEY?.trim();
    if (!apiKey) {
      return { checkoutUrl: staticUrl, mode: 'static' };
    }

    try {
      const res = await fetch(`${this.apiBase()}/checkouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          product_cart: [{ product_id: this.proProductId(), quantity: 1 }],
          customer: { email: input.email, name: input.name },
          return_url: `${this.appPublicUrl()}/subscription`,
          metadata: { userId: input.userId },
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.warn(
          `Dodo checkout session failed (${res.status}): ${detail.slice(0, 200)}`,
        );
        return { checkoutUrl: staticUrl, mode: 'static' };
      }
      const data = (await res.json()) as { checkout_url?: string };
      if (!data.checkout_url) {
        return { checkoutUrl: staticUrl, mode: 'static' };
      }
      return { checkoutUrl: data.checkout_url, mode: 'session' };
    } catch (err) {
      this.logger.warn(
        `Dodo checkout session error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { checkoutUrl: staticUrl, mode: 'static' };
    }
  }

  /**
   * Standard Webhooks verification (Dodo).
   * @see https://docs.dodopayments.com/developer-resources/integration-guide
   */
  verifyWebhook(
    rawBody: string,
    headers: {
      'webhook-id'?: string;
      'webhook-signature'?: string;
      'webhook-timestamp'?: string;
    },
  ): void {
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'DODO_PAYMENTS_WEBHOOK_KEY is not configured',
      );
    }
    const id = headers['webhook-id'] || '';
    const signature = headers['webhook-signature'] || '';
    const timestamp = headers['webhook-timestamp'] || '';
    if (!id || !signature || !timestamp) {
      throw new BadRequestException('Missing webhook signature headers');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Webhook } = require('standardwebhooks') as {
        Webhook: new (secret: string) => {
          verify: (
            payload: string,
            headers: Record<string, string>,
          ) => unknown;
        };
      };
      const wh = new Webhook(secret);
      wh.verify(rawBody, {
        'webhook-id': id,
        'webhook-signature': signature,
        'webhook-timestamp': timestamp,
      });
      return;
    } catch (err) {
      this.logger.warn(
        `Webhook verify via standardwebhooks failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Fallback HMAC (whsec_ base64 key material)
    const keyMaterial = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice(6), 'base64')
      : Buffer.from(secret, 'utf8');

    const signedContent = `${id}.${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', keyMaterial)
      .update(signedContent)
      .digest('base64');

    const candidates: string[] = [];
    const v1Match = signature.match(/v1,([A-Za-z0-9+/=]+)/g) || [];
    for (const m of v1Match) candidates.push(m.slice(3));
    if (!candidates.length) candidates.push(signature.replace(/^v1,/, ''));

    const ok = candidates.some((cand) => {
      try {
        const a = Buffer.from(cand);
        const b = Buffer.from(expected);
        return a.length === b.length && timingSafeEqual(a, b);
      } catch {
        return false;
      }
    });

    if (!ok) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  async handleWebhookEvent(payload: {
    type?: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const type = String(payload.type || '');
    const data = payload.data || {};

    if (
      type === 'subscription.active' ||
      type === 'subscription.renewed' ||
      type === 'payment.succeeded'
    ) {
      await this.activateProFromPayload(data, type);
      return;
    }

    if (type === 'subscription.on_hold' || type === 'subscription.failed') {
      await this.downgradeFromPayload(data, type);
      return;
    }

    this.logger.log(`Ignoring Dodo webhook type=${type}`);
  }

  /**
   * After Dodo redirects back:
   *   one-time:  ?status=succeeded&payment_id=pay_…
   *   subscription (Pro $10/mo): ?status=active&subscription_id=sub_…
   * Marks Pro with a real pay_/sub_ id. Verifies via Dodo API when
   * DODO_PAYMENTS_API_KEY is set; otherwise accepts the signed-in redirect
   * (webhooks still recommended for renewals / missed redirects).
   */
  async confirmCheckoutReturn(input: {
    userId: string;
    email: string;
    paymentId?: string | null;
    subscriptionId?: string | null;
    status?: string | null;
  }): Promise<{ ok: boolean; plan: 'free' | 'pro'; verified: boolean }> {
    const status = (input.status || '').toLowerCase();
    const okStatuses = new Set(['succeeded', 'success', 'active']);
    if (status && !okStatuses.has(status)) {
      throw new BadRequestException('Checkout did not succeed');
    }

    let paymentId = input.paymentId?.trim() || '';
    let subscriptionId = input.subscriptionId?.trim() || '';

    // Clients sometimes put sub_ in the paymentId field from a generic param
    if (!subscriptionId && /^sub_[\w-]+$/i.test(paymentId)) {
      subscriptionId = paymentId;
      paymentId = '';
    }

    const hasPay = Boolean(paymentId && /^pay_[\w-]+$/i.test(paymentId));
    const hasSub = Boolean(
      subscriptionId && /^sub_[\w-]+$/i.test(subscriptionId),
    );
    if (!hasPay && !hasSub) {
      throw new BadRequestException(
        'A Dodo payment_id or subscription_id is required to confirm Pro. Complete checkout and return from Dodo.',
      );
    }

    let verified = false;
    let customerId: string | null = null;
    let paidAt = new Date();

    const apiKey = process.env.DODO_PAYMENTS_API_KEY?.trim();
    if (apiKey) {
      if (hasPay) {
        const res = await fetch(
          `${this.apiBase()}/payments/${encodeURIComponent(paymentId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!res.ok) {
          throw new BadRequestException(
            'Could not verify this payment with Dodo. If you just paid, wait a moment and refresh — or contact support with your receipt.',
          );
        }
        const pay = (await res.json()) as {
          status?: string;
          created_at?: string;
          customer?: { customer_id?: string; email?: string };
          customer_id?: string;
          subscription_id?: string;
          metadata?: Record<string, unknown>;
          product_cart?: Array<{ product_id?: string }>;
        };
        const payStatus = (pay.status || '').toLowerCase();
        if (payStatus && !okStatuses.has(payStatus)) {
          throw new BadRequestException(`Payment status is ${pay.status}`);
        }
        this.assertPaymentBelongsToUser(pay, input);
        verified = true;
        customerId = pay.customer_id || pay.customer?.customer_id || null;
        if (
          !subscriptionId &&
          typeof pay.subscription_id === 'string'
        ) {
          subscriptionId = pay.subscription_id;
        }
        if (pay.created_at) {
          const parsed = new Date(pay.created_at);
          if (!Number.isNaN(parsed.getTime())) paidAt = parsed;
        }
      } else {
        const res = await fetch(
          `${this.apiBase()}/subscriptions/${encodeURIComponent(subscriptionId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!res.ok) {
          throw new BadRequestException(
            'Could not verify this subscription with Dodo. If you just paid, wait a moment and refresh — or contact support with your receipt.',
          );
        }
        const sub = (await res.json()) as {
          status?: string;
          created_at?: string;
          customer?: { customer_id?: string; email?: string };
          customer_id?: string;
          subscription_id?: string;
          metadata?: Record<string, unknown>;
          product_id?: string;
        };
        const subStatus = (sub.status || '').toLowerCase();
        if (
          subStatus &&
          !okStatuses.has(subStatus) &&
          subStatus !== 'pending'
        ) {
          throw new BadRequestException(
            `Subscription status is ${sub.status}`,
          );
        }
        this.assertPaymentBelongsToUser(sub, input);
        if (sub.product_id && sub.product_id !== this.proProductId()) {
          throw new BadRequestException('Payment is not for Cupkey Pro');
        }
        verified = true;
        customerId = sub.customer_id || sub.customer?.customer_id || null;
        if (sub.created_at) {
          const parsed = new Date(sub.created_at);
          if (!Number.isNaN(parsed.getTime())) paidAt = parsed;
        }
      }
    } else if (!status) {
      throw new BadRequestException(
        'Payment verification is not configured. Set DODO_PAYMENTS_API_KEY or complete checkout so Dodo redirects with status.',
      );
    }

    // Idempotent: same payment / subscription already applied
    const existing = await this.getBillingProfile(input.userId);
    if (
      existing.plan === 'pro' &&
      ((hasPay && existing.dodoPaymentId === paymentId) ||
        (hasSub && existing.dodoSubscriptionId === subscriptionId))
    ) {
      return { ok: true, plan: 'pro', verified: true };
    }

    await this.applyPlan(input.userId, {
      plan: 'pro',
      // Paid = locked; admin activates when AI features go live
      planStatus: 'pending_activation',
      dodoCustomerId: customerId,
      dodoSubscriptionId: hasSub ? subscriptionId : null,
      dodoPaymentId: hasPay ? paymentId : null,
      proPaidAt: paidAt,
    });
    this.logger.log(
      `Pro paid (pending activation) for ${input.userId} payment=${paymentId || 'n/a'} sub=${subscriptionId || 'n/a'} verified=${verified}`,
    );
    return { ok: true, plan: 'pro', verified };
  }

  private assertPaymentBelongsToUser(
    pay: {
      customer?: { email?: string };
      metadata?: Record<string, unknown>;
      product_cart?: Array<{ product_id?: string }>;
    },
    input: { userId: string; email: string },
  ) {
    const metaUser =
      typeof pay.metadata?.userId === 'string'
        ? pay.metadata.userId
        : typeof pay.metadata?.user_id === 'string'
          ? pay.metadata.user_id
          : null;
    const payEmail = pay.customer?.email?.toLowerCase() || null;
    const emailMatch = payEmail && payEmail === input.email.toLowerCase();
    const userMatch = metaUser && metaUser === input.userId;
    if (!userMatch && !emailMatch) {
      throw new BadRequestException(
        'This payment does not belong to your Cupkey account',
      );
    }
    const cartProduct =
      Array.isArray(pay.product_cart) &&
      typeof pay.product_cart[0]?.product_id === 'string'
        ? pay.product_cart[0].product_id
        : null;
    if (cartProduct && cartProduct !== this.proProductId()) {
      throw new BadRequestException('Payment is not for Cupkey Pro');
    }
  }

  private extractUserId(data: Record<string, unknown>): string | null {
    const meta = (data.metadata || {}) as Record<string, unknown>;
    const fromMeta =
      (typeof meta.userId === 'string' && meta.userId) ||
      (typeof meta.user_id === 'string' && meta.user_id) ||
      null;
    if (fromMeta) return fromMeta;

    const customer = (data.customer || {}) as Record<string, unknown>;
    // Sometimes nested
    const custMeta = (customer.metadata || {}) as Record<string, unknown>;
    if (typeof custMeta.userId === 'string') return custMeta.userId;

    return null;
  }

  private extractEmail(data: Record<string, unknown>): string | null {
    const customer = (data.customer || {}) as Record<string, unknown>;
    if (typeof customer.email === 'string') return customer.email.toLowerCase();
    if (typeof data.email === 'string') return data.email.toLowerCase();
    return null;
  }

  private async activateProFromPayload(
    data: Record<string, unknown>,
    type: string,
  ) {
    const productId =
      (typeof data.product_id === 'string' && data.product_id) ||
      (Array.isArray(data.product_cart) &&
        typeof (data.product_cart[0] as { product_id?: string })?.product_id ===
          'string' &&
        (data.product_cart[0] as { product_id: string }).product_id) ||
      null;

    // Only gate on product when present — subscription payloads may omit it
    if (productId && productId !== this.proProductId()) {
      this.logger.log(`Skip non-Pro product ${productId}`);
      return;
    }

    const userId = this.extractUserId(data);
    const email = this.extractEmail(data);
    const subscriptionId =
      (typeof data.subscription_id === 'string' && data.subscription_id) ||
      (typeof data.subscriptionId === 'string' && data.subscriptionId) ||
      null;
    const customerId =
      (typeof data.customer_id === 'string' && data.customer_id) ||
      (typeof (data.customer as { customer_id?: string })?.customer_id ===
        'string' &&
        (data.customer as { customer_id: string }).customer_id) ||
      null;
    const paymentId =
      (typeof data.payment_id === 'string' && data.payment_id) ||
      (typeof data.paymentId === 'string' && data.paymentId) ||
      null;

    const resolved = await this.resolveUserId(userId, email);
    if (!resolved) {
      this.logger.warn(
        `Pro activate: no user for userId=${userId} email=${email} type=${type}`,
      );
      return;
    }

    await this.applyPlan(resolved, {
      plan: 'pro',
      planStatus: 'pending_activation',
      dodoCustomerId: customerId,
      dodoSubscriptionId: subscriptionId,
      ...(paymentId ? { dodoPaymentId: paymentId } : {}),
      proPaidAt: new Date(),
    });
    this.logger.log(`Pro paid (pending) for user ${resolved} (${type})`);
  }

  private async downgradeFromPayload(
    data: Record<string, unknown>,
    type: string,
  ) {
    const userId = this.extractUserId(data);
    const email = this.extractEmail(data);
    const resolved = await this.resolveUserId(userId, email);
    if (!resolved) return;

    const status = type === 'subscription.on_hold' ? 'on_hold' : 'failed';
    await this.applyPlan(resolved, {
      plan: status === 'on_hold' ? 'pro' : 'free',
      planStatus: status,
    });
    this.logger.log(`Plan status → ${status} for user ${resolved}`);
  }

  private async resolveUserId(
    userId: string | null,
    email: string | null,
  ): Promise<string | null> {
    if (userId) {
      if (userId.startsWith('local_')) {
        const local = this.localUsers.findById(userId);
        if (local) return local.id;
      }
      try {
        const u = await this.prisma.user.findUnique({ where: { id: userId } });
        if (u) return u.id;
      } catch {
        /* REST */
      }
      if (this.supabase.isConfigured()) {
        const u = await this.supabase.getUserById(userId);
        if (u) return u.id;
      }
    }
    if (email) {
      if (this.supabase.isConfigured()) {
        const u = await this.supabase.getUserByEmail(email);
        if (u) return u.id;
      }
      try {
        const u = await this.prisma.user.findUnique({ where: { email } });
        if (u) return u.id;
      } catch {
        /* ignore */
      }
      const local = this.localUsers.findByEmail(email);
      if (local) return local.id;
    }
    return null;
  }

  async applyPlan(userId: string, patch: PlanPatch): Promise<void> {
    const now = new Date();
    const paidAt =
      patch.proPaidAt === undefined
        ? undefined
        : patch.proPaidAt
          ? new Date(patch.proPaidAt)
          : null;
    const activatedAt =
      patch.proActivatedAt === undefined
        ? undefined
        : patch.proActivatedAt
          ? new Date(patch.proActivatedAt)
          : null;

    if (userId.startsWith('local_')) {
      const local = this.localUsers.findById(userId);
      if (local) {
        local.plan = patch.plan;
        local.planStatus = patch.planStatus ?? local.planStatus;
        local.dodoCustomerId = patch.dodoCustomerId ?? local.dodoCustomerId;
        local.dodoSubscriptionId =
          patch.dodoSubscriptionId ?? local.dodoSubscriptionId;
        if (patch.dodoPaymentId !== undefined) {
          local.dodoPaymentId = patch.dodoPaymentId;
        }
        if (paidAt) local.proPaidAt = paidAt.toISOString();
        if (activatedAt) local.proActivatedAt = activatedAt.toISOString();
        this.localUsers.save(local);
      }
      return;
    }

    const data: Record<string, unknown> = {
      plan: patch.plan,
      planUpdatedAt: now.toISOString(),
    };
    if (patch.planStatus !== undefined) data.planStatus = patch.planStatus;
    if (patch.dodoCustomerId !== undefined) {
      data.dodoCustomerId = patch.dodoCustomerId;
    }
    if (patch.dodoSubscriptionId !== undefined) {
      data.dodoSubscriptionId = patch.dodoSubscriptionId;
    }
    if (patch.dodoPaymentId !== undefined) {
      data.dodoPaymentId = patch.dodoPaymentId;
    }
    if (paidAt !== undefined) {
      data.proPaidAt = paidAt ? paidAt.toISOString() : null;
    }
    if (activatedAt !== undefined) {
      data.proActivatedAt = activatedAt ? activatedAt.toISOString() : null;
    }

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          plan: patch.plan,
          planStatus: patch.planStatus ?? undefined,
          dodoCustomerId: patch.dodoCustomerId ?? undefined,
          dodoSubscriptionId: patch.dodoSubscriptionId ?? undefined,
          dodoPaymentId: patch.dodoPaymentId ?? undefined,
          planUpdatedAt: now,
          ...(paidAt !== undefined ? { proPaidAt: paidAt } : {}),
          ...(activatedAt !== undefined ? { proActivatedAt: activatedAt } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Prisma plan update failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (this.supabase.isConfigured()) {
      try {
        await this.supabase.patch('User', `id=eq.${userId}`, {
          ...data,
          updatedAt: now.toISOString(),
        });
      } catch (err) {
        this.logger.warn(
          `REST plan update failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async getBillingProfile(userId: string): Promise<{
    plan: 'free' | 'pro';
    planStatus: string | null;
    planUpdatedAt: string | null;
    dodoCustomerId: string | null;
    dodoSubscriptionId: string | null;
    dodoPaymentId: string | null;
    proPaidAt: string | null;
    proActivatedAt: string | null;
    email: string | null;
    name: string | null;
  }> {
    if (userId.startsWith('local_')) {
      const local = this.localUsers.findById(userId);
      return {
        plan: local?.plan === 'pro' ? 'pro' : 'free',
        planStatus: local?.planStatus ?? null,
        planUpdatedAt: null,
        dodoCustomerId: local?.dodoCustomerId ?? null,
        dodoSubscriptionId: local?.dodoSubscriptionId ?? null,
        dodoPaymentId: local?.dodoPaymentId ?? null,
        proPaidAt: local?.proPaidAt ?? null,
        proActivatedAt: local?.proActivatedAt ?? null,
        email: local?.email ?? null,
        name: local?.name ?? null,
      };
    }

    try {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          plan: true,
          planStatus: true,
          planUpdatedAt: true,
          dodoCustomerId: true,
          dodoSubscriptionId: true,
          dodoPaymentId: true,
          proPaidAt: true,
          proActivatedAt: true,
          email: true,
          name: true,
        },
      });
      if (u) {
        return {
          plan: u.plan === 'pro' ? 'pro' : 'free',
          planStatus: u.planStatus ?? null,
          planUpdatedAt: u.planUpdatedAt?.toISOString() ?? null,
          dodoCustomerId: u.dodoCustomerId ?? null,
          dodoSubscriptionId: u.dodoSubscriptionId ?? null,
          dodoPaymentId: u.dodoPaymentId ?? null,
          proPaidAt: u.proPaidAt?.toISOString() ?? null,
          proActivatedAt: u.proActivatedAt?.toISOString() ?? null,
          email: u.email,
          name: u.name,
        };
      }
    } catch {
      /* REST */
    }

    if (this.supabase.isConfigured()) {
      try {
        const rows = await this.supabase.select<{
          plan?: string;
          planStatus?: string | null;
          planUpdatedAt?: string | null;
          dodoCustomerId?: string | null;
          dodoSubscriptionId?: string | null;
          dodoPaymentId?: string | null;
          proPaidAt?: string | null;
          proActivatedAt?: string | null;
          email?: string;
          name?: string;
        }>(
          'User',
          'plan,planStatus,planUpdatedAt,dodoCustomerId,dodoSubscriptionId,dodoPaymentId,proPaidAt,proActivatedAt,email,name',
          { filter: `id=eq.${userId}`, limit: 1 },
        );
        const u = rows[0];
        if (u) {
          return {
            plan: u.plan === 'pro' ? 'pro' : 'free',
            planStatus: u.planStatus ?? null,
            planUpdatedAt: u.planUpdatedAt ?? null,
            dodoCustomerId: u.dodoCustomerId ?? null,
            dodoSubscriptionId: u.dodoSubscriptionId ?? null,
            dodoPaymentId: u.dodoPaymentId ?? null,
            proPaidAt: u.proPaidAt ?? null,
            proActivatedAt: u.proActivatedAt ?? null,
            email: u.email ?? null,
            name: u.name ?? null,
          };
        }
      } catch {
        /* columns may be missing */
      }
    }

    return {
      plan: 'free',
      planStatus: null,
      planUpdatedAt: null,
      dodoCustomerId: null,
      dodoSubscriptionId: null,
      dodoPaymentId: null,
      proPaidAt: null,
      proActivatedAt: null,
      email: null,
      name: null,
    };
  }

  statusLabel(plan: 'free' | 'pro', planStatus: string | null): string {
    if (plan !== 'pro') return 'No paid subscription';
    switch ((planStatus || 'pending_activation').toLowerCase()) {
      case 'active':
        return 'Active';
      case 'pending_activation':
        return 'Paid — waiting for AI go-live';
      case 'on_hold':
        return 'On hold';
      case 'cancelled':
        return 'Cancelled';
      case 'failed':
        return 'Payment failed';
      default:
        return planStatus || 'Paid — waiting for AI go-live';
    }
  }

  async listInvoices(userId: string): Promise<{
    invoicesAvailable: boolean;
    invoices: Array<{
      paymentId: string;
      createdAt: string;
      amountLabel: string;
      currency: string;
      status: string;
    }>;
  }> {
    const apiKey = process.env.DODO_PAYMENTS_API_KEY?.trim();
    if (!apiKey) {
      return { invoicesAvailable: false, invoices: [] };
    }

    const profile = await this.getBillingProfile(userId);
    const invoices: Array<{
      paymentId: string;
      createdAt: string;
      amountLabel: string;
      currency: string;
      status: string;
    }> = [];

    const pushPayment = (p: {
      payment_id?: string;
      created_at?: string;
      total_amount?: number;
      currency?: string;
      status?: string;
    }) => {
      if (!p.payment_id) return;
      if (invoices.some((i) => i.paymentId === p.payment_id)) return;
      const amount = Number(p.total_amount ?? 0);
      const currency = (p.currency || 'USD').toUpperCase();
      // Dodo often uses minor units (cents)
      const major = amount >= 1000 || amount % 1 === 0 ? amount / 100 : amount;
      const amountLabel = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: ['USD', 'INR', 'EUR', 'GBP'].includes(currency)
          ? currency
          : 'USD',
      }).format(Number.isFinite(major) && major > 0 ? major : amount / 100);
      invoices.push({
        paymentId: p.payment_id,
        createdAt: p.created_at || new Date().toISOString(),
        amountLabel,
        currency,
        status: p.status || 'succeeded',
      });
    };

    // Prefer the payment we stored at checkout
    if (profile.dodoPaymentId && /^pay_/i.test(profile.dodoPaymentId)) {
      try {
        const res = await fetch(
          `${this.apiBase()}/payments/${encodeURIComponent(profile.dodoPaymentId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (res.ok) {
          pushPayment(
            (await res.json()) as {
              payment_id?: string;
              created_at?: string;
              total_amount?: number;
              currency?: string;
              status?: string;
            },
          );
        }
      } catch (err) {
        this.logger.warn(
          `Dodo get payment failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Also list by customer / filter by email
    try {
      const params = new URLSearchParams({
        page_size: '50',
        page_number: '0',
      });
      if (profile.dodoCustomerId) {
        params.set('customer_id', profile.dodoCustomerId);
      }
      const res = await fetch(`${this.apiBase()}/payments?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{
            payment_id?: string;
            created_at?: string;
            total_amount?: number;
            currency?: string;
            status?: string;
            customer?: { email?: string; customer_id?: string };
          }>;
        };
        let items = data.items ?? [];
        if (profile.email) {
          const email = profile.email.toLowerCase();
          items = items.filter((p) => {
            if (profile.dodoCustomerId) return true;
            return p.customer?.email?.toLowerCase() === email;
          });
        } else if (!profile.dodoCustomerId) {
          items = [];
        }
        for (const p of items) pushPayment(p);
      } else {
        this.logger.warn(`Dodo list payments failed: ${res.status}`);
      }
    } catch (err) {
      this.logger.warn(
        `Dodo list payments error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { invoicesAvailable: true, invoices };
  }

  /** Official Dodo Payments invoice PDF only — no custom receipts. */
  async downloadInvoicePdf(
    userId: string,
    paymentId: string,
  ): Promise<Buffer> {
    const apiKey = process.env.DODO_PAYMENTS_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Set DODO_PAYMENTS_API_KEY to download invoices from Dodo Payments',
      );
    }

    const id = paymentId.trim();
    if (!id || !/^pay_[\w-]+$/i.test(id)) {
      throw new BadRequestException('Invalid Dodo payment id');
    }

    const { invoices } = await this.listInvoices(userId);
    const profile = await this.getBillingProfile(userId);
    const allowed =
      invoices.some((i) => i.paymentId === id) ||
      profile.dodoPaymentId === id;
    if (!allowed) {
      throw new BadRequestException('Invoice not found for this account');
    }

    const res = await fetch(
      `${this.apiBase()}/invoices/payments/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(
        `Dodo invoice ${id} → ${res.status} ${detail.slice(0, 200)}`,
      );
      throw new BadRequestException(
        'Could not fetch invoice from Dodo Payments. Try again or check the payment in the Dodo dashboard.',
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** Admin: everyone who paid for Pro (pending or active). */
  async listProPayers(): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      plan: string;
      planStatus: string | null;
      proPaidAt: string | null;
      proActivatedAt: string | null;
      dodoPaymentId: string | null;
    }>
  > {
    const mapRow = (u: {
      id: string;
      name: string;
      email: string;
      plan?: string | null;
      planStatus?: string | null;
      proPaidAt?: Date | string | null;
      proActivatedAt?: Date | string | null;
      dodoPaymentId?: string | null;
    }) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      plan: u.plan || 'pro',
      planStatus: u.planStatus ?? null,
      proPaidAt:
        !u.proPaidAt
          ? null
          : typeof u.proPaidAt === 'string'
            ? u.proPaidAt
            : u.proPaidAt.toISOString(),
      proActivatedAt:
        !u.proActivatedAt
          ? null
          : typeof u.proActivatedAt === 'string'
            ? u.proActivatedAt
            : u.proActivatedAt.toISOString(),
      dodoPaymentId: u.dodoPaymentId ?? null,
    });

    try {
      const rows = await this.prisma.user.findMany({
        where: { plan: 'pro' },
        orderBy: { planUpdatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          plan: true,
          planStatus: true,
          proPaidAt: true,
          proActivatedAt: true,
          dodoPaymentId: true,
        },
      });
      return rows.map(mapRow);
    } catch {
      /* REST */
    }

    if (this.supabase.isConfigured()) {
      try {
        const rows = await this.supabase.select<{
          id: string;
          name: string;
          email: string;
          plan?: string;
          planStatus?: string | null;
          proPaidAt?: string | null;
          proActivatedAt?: string | null;
          dodoPaymentId?: string | null;
        }>(
          'User',
          'id,name,email,plan,planStatus,proPaidAt,proActivatedAt,dodoPaymentId',
          { filter: 'plan=eq.pro', limit: 500 },
        );
        return rows.map(mapRow);
      } catch {
        /* ignore */
      }
    }

    return this.localUsers.readAll()
      .filter((u) => u.plan === 'pro')
      .map(mapRow);
  }

  async activateProUsers(
    userIds: string[] | 'all_pending',
  ): Promise<{ activated: Array<{ id: string; email: string; name: string }> }> {
    const payers = await this.listProPayers();
    const targets =
      userIds === 'all_pending'
        ? payers.filter(
            (p) =>
              p.planStatus !== 'active' ||
              !p.proActivatedAt,
          )
        : payers.filter((p) => userIds.includes(p.id));

    const activated: Array<{ id: string; email: string; name: string }> = [];
    const now = new Date();
    for (const t of targets) {
      await this.applyPlan(t.id, {
        plan: 'pro',
        planStatus: 'active',
        proActivatedAt: now,
      });
      activated.push({ id: t.id, email: t.email, name: t.name });
    }
    return { activated };
  }
}
