import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as https from 'node:https';
import * as dns from 'node:dns';

export type BrevoSendResult = { ok: true } | { ok: false; error: string };

/** Prefer IPv4 so Brevo IP allowlists / Vercel egress behave predictably. */
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* Node < 17 */
}

@Injectable()
export class BrevoMailService implements OnModuleInit {
  private readonly logger = new Logger(BrevoMailService.name);

  onModuleInit() {
    if (this.isConfigured()) {
      this.logger.log(
        `Brevo mail ready (sender=${process.env.BREVO_SENDER_EMAIL?.trim()})`,
      );
    } else {
      this.logger.warn(
        'Brevo not configured — set BREVO_API_KEY and BREVO_SENDER_EMAIL or welcome emails will be skipped',
      );
    }
  }

  isConfigured() {
    return Boolean(
      process.env.BREVO_API_KEY?.trim() &&
        process.env.BREVO_SENDER_EMAIL?.trim(),
    );
  }

  /** Public app URL for email CTAs (dashboard / login). */
  appPublicUrl() {
    const explicit =
      process.env.APP_PUBLIC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (explicit) return explicit.replace(/\/$/, '');

    const origins = (process.env.WEB_ORIGIN ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const prod = origins.find(
      (o) =>
        o.includes('cupkey.io') ||
        (!o.includes('localhost') && !o.includes('127.0.0.1')),
    );
    if (prod) return prod.replace(/\/$/, '');
    return (origins[0] || 'https://app.cupkey.io').replace(/\/$/, '');
  }

  /**
   * First-time welcome email from the founder.
   * Never throws — signup must not fail if mail is down.
   */
  async sendWelcomeEmail(input: {
    toEmail: string;
    toName?: string;
  }): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn(
        'Brevo not configured (BREVO_API_KEY / BREVO_SENDER_EMAIL) — skip welcome email',
      );
      return false;
    }

    const firstName = firstNameFrom(input.toName, input.toEmail);
    const dashboardUrl = `${this.appPublicUrl()}/schedule`;
    const safeName = escapeHtml(firstName);

    const textContent = `Hey ${firstName},

Welcome to Cupkey.

This started as a passion project. I built it for myself, used it locally for years, and finally decided to put it out for everyone. I hope it helps you get things done.

Here's the story behind it. A while back I came across an idea that stuck with me: you already know what you want to achieve and how to get there, and the only reason you haven't is that you haven't done the work. That day I realized almost all of my effort was going into planning. Very little was going into actually executing.

Cupkey exists to fix exactly that. The goal is simple: help you execute your plan, not just make one.

So, welcome to the club. I'd love to know one thing: what's the goal you're trying to hit right now? And if you have any ideas to make Cupkey better, just hit reply. I read everything.

Talk soon,
Lakshmanan Raman
Founder, cupkey.io

Open your dashboard: ${dashboardUrl}
`;

    const htmlContent = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:40px 36px;">
          <tr>
            <td style="color:#18181b;font-size:16px;line-height:1.65;padding-bottom:18px;">
              Hey ${safeName},
            </td>
          </tr>
          <tr>
            <td style="color:#18181b;font-size:16px;line-height:1.65;padding-bottom:18px;">
              Welcome to Cupkey.
            </td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:16px;line-height:1.65;padding-bottom:18px;">
              This started as a passion project. I built it for myself, used it locally for years, and finally decided to put it out for everyone. I hope it helps you get things done.
            </td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:16px;line-height:1.65;padding-bottom:18px;">
              Here's the story behind it. A while back I came across an idea that stuck with me: you already know what you want to achieve and how to get there, and the only reason you haven't is that you haven't done the work. That day I realized almost all of my effort was going into planning. Very little was going into actually executing.
            </td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:16px;line-height:1.65;padding-bottom:18px;">
              Cupkey exists to fix exactly that. The goal is simple: help you execute your plan, not just make one.
            </td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:16px;line-height:1.65;padding-bottom:28px;">
              So, welcome to the club. I'd love to know one thing: what's the goal you're trying to hit right now? And if you have any ideas to make Cupkey better, just hit reply. I read everything.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${dashboardUrl}"
                 style="display:inline-block;background:#ff5722;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px;">
                Open your dashboard
              </a>
            </td>
          </tr>
          <tr>
            <td style="color:#18181b;font-size:16px;line-height:1.65;">
              Talk soon,<br/>
              Lakshmanan Raman<br/>
              <span style="color:#71717a;">Founder, cupkey.io</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // Retry once — Vercel cold starts + Brevo blips are common.
    let result = await this.sendTransactional({
      toEmail: input.toEmail,
      toName: firstName,
      subject: 'Welcome to the Cupkey club',
      htmlContent,
      textContent,
      replyToSender: true,
    });
    if (!result.ok) {
      this.logger.warn(
        `Welcome email first attempt failed for ${input.toEmail}: ${result.error}`,
      );
      await sleep(400);
      result = await this.sendTransactional({
        toEmail: input.toEmail,
        toName: firstName,
        subject: 'Welcome to the Cupkey club',
        htmlContent,
        textContent,
        replyToSender: true,
      });
    }
    if (result.ok) {
      this.logger.log(`Welcome email sent to ${input.toEmail}`);
    } else {
      this.logger.warn(
        `Welcome email failed for ${input.toEmail}: ${result.error}`,
      );
    }
    return result.ok;
  }

  /** Pro activated by admin when AI features go live. */
  async sendProActivatedEmail(input: {
    toEmail: string;
    toName?: string;
    activatedAt: Date;
  }): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn('Brevo not configured — skip Pro activated email');
      return false;
    }
    const firstName = firstNameFrom(input.toName, input.toEmail);
    const safeName = escapeHtml(firstName);
    const dash = `${this.appPublicUrl()}/pricing`;
    const when = input.activatedAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const next = new Date(input.activatedAt);
    next.setDate(next.getDate() + 30);
    const nextLabel = next.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const textContent = `Hey ${firstName},

Great news — your Cupkey Pro plan is now active.

AI features are live. Your subscription period starts ${when}.
Your first billing cycle runs until ${nextLabel}.

Open Subscription: ${dash}

— Cupkey`;

    const htmlContent = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:24px;">
<table role="presentation" width="100%"><tr><td align="center">
<table width="560" style="background:#fff;border-radius:12px;padding:36px;border:1px solid #e4e4e7;">
<tr><td style="font-size:16px;color:#18181b;padding-bottom:16px;">Hey ${safeName},</td></tr>
<tr><td style="font-size:16px;color:#18181b;padding-bottom:16px;"><strong>Your Cupkey Pro plan is now active.</strong></td></tr>
<tr><td style="font-size:15px;color:#3f3f46;line-height:1.6;padding-bottom:16px;">
AI features are live. Your subscription countdown starts <strong>${escapeHtml(when)}</strong>.
This billing cycle runs until <strong>${escapeHtml(nextLabel)}</strong>.
</td></tr>
<tr><td align="center" style="padding:20px 0;">
<a href="${dash}" style="display:inline-block;background:#ff5722;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px;">View subscription</a>
</td></tr>
<tr><td style="font-size:14px;color:#71717a;">— Cupkey</td></tr>
</table></td></tr></table></body></html>`;

    const result = await this.sendTransactional({
      toEmail: input.toEmail,
      toName: firstName,
      subject: 'Your Cupkey Pro plan is now active',
      htmlContent,
      textContent,
      replyToSender: true,
    });
    if (result.ok) this.logger.log(`Pro activated email → ${input.toEmail}`);
    else
      this.logger.warn(
        `Pro activated email failed ${input.toEmail}: ${result.error}`,
      );
    return result.ok;
  }

  /** Timesheet share email — returns structured result for UI errors. */
  async sendTimesheetShareEmail(input: {
    toEmail: string;
    fromName: string;
    fromEmail?: string;
    dateLabel: string;
    workDate: string;
    shareUrl: string;
  }): Promise<BrevoSendResult> {
    if (!this.isConfigured()) {
      this.logger.warn('Brevo not configured — cannot send timesheet share');
      return {
        ok: false,
        error:
          'Email is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL on the server.',
      };
    }

    const to = input.toEmail.trim().toLowerCase();
    const fromName = (input.fromName || 'Cupkey user').slice(0, 80);
    const safeFrom = escapeHtml(fromName);
    const safeDate = escapeHtml(input.dateLabel);
    const safeWork = escapeHtml(input.workDate);
    const url = input.shareUrl.trim();

    const textContent = `Hi,

${fromName} shared a Cupkey timesheet for ${input.dateLabel} (${input.workDate}).

View it here (no login needed):
${url}

This link works for 30 days.

— Cupkey`;

    const htmlContent = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:28px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:32px 28px;">
          <tr>
            <td style="color:#ff5722;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding-bottom:12px;">Cupkey</td>
          </tr>
          <tr>
            <td style="color:#18181b;font-size:20px;font-weight:800;padding-bottom:12px;">Timesheet shared with you</td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:15px;line-height:1.55;padding-bottom:20px;">
              <strong>${safeFrom}</strong> shared a daily timesheet for
              <strong>${safeDate}</strong> (${safeWork}).
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:18px;">
              <a href="${escapeHtml(url)}"
                 style="display:inline-block;background:#ff5722;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:999px;">
                View timesheet
              </a>
            </td>
          </tr>
          <tr>
            <td style="color:#71717a;font-size:12px;line-height:1.5;">
              View-only link · valid 30 days · no login required
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const replyTo =
      input.fromEmail?.trim() && /@/.test(input.fromEmail)
        ? {
            name: fromName,
            email: input.fromEmail.trim().toLowerCase(),
          }
        : undefined;

    return this.sendTransactional({
      toEmail: to,
      toName: to.split('@')[0],
      subject: `Cupkey timesheet — ${input.dateLabel}`,
      htmlContent,
      textContent,
      replyTo,
    });
  }

  private async sendTransactional(input: {
    toEmail: string;
    toName?: string;
    subject: string;
    htmlContent: string;
    textContent: string;
    replyToSender?: boolean;
    replyTo?: { name: string; email: string };
  }): Promise<BrevoSendResult> {
    const apiKey = process.env.BREVO_API_KEY!.trim();
    const senderEmail = process.env.BREVO_SENDER_EMAIL!.trim();
    const senderName =
      process.env.BREVO_SENDER_NAME?.trim() || 'Lakshmanan Raman';
    const name = (input.toName || input.toEmail.split('@')[0] || 'there').slice(
      0,
      80,
    );

    const payload = JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: input.toEmail.trim().toLowerCase(), name }],
      ...(input.replyTo
        ? { replyTo: input.replyTo }
        : input.replyToSender
          ? { replyTo: { name: senderName, email: senderEmail } }
          : {}),
      subject: input.subject,
      htmlContent: input.htmlContent,
      textContent: input.textContent,
    });

    try {
      // Force IPv4 — Brevo IP allowlists often miss rotating IPv6 addresses.
      const { status, body } = await httpsJsonRequest({
        method: 'POST',
        path: '/v3/smtp/email',
        apiKey,
        payload,
        timeoutMs: 12_000,
      });

      if (status < 200 || status >= 300) {
        const error = formatBrevoError(status, body);
        this.logger.warn(`Brevo email failed (${status}): ${error}`);
        return { ok: false, error };
      }
      this.logger.log(`Email queued for ${input.toEmail}: ${input.subject}`);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Brevo email error: ${message}`);
      return { ok: false, error: `Could not reach Brevo: ${message}` };
    }
  }
}

function httpsJsonRequest(input: {
  method: 'GET' | 'POST';
  path: string;
  apiKey: string;
  payload?: string;
  timeoutMs?: number;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        path: input.path,
        method: input.method,
        family: 4,
        servername: 'api.brevo.com',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': input.apiKey,
          ...(input.payload
            ? { 'content-length': Buffer.byteLength(input.payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.setTimeout(input.timeoutMs ?? 12_000, () => {
      req.destroy(new Error('Brevo request timed out'));
    });
    req.on('error', reject);
    if (input.payload) req.write(input.payload);
    req.end();
  });
}

function formatBrevoError(status: number, body: string): string {
  let message = '';
  try {
    const parsed = JSON.parse(body) as { message?: string; code?: string };
    message = String(parsed.message || parsed.code || '').trim();
  } catch {
    message = body.trim();
  }
  if (/unrecognised IP address/i.test(message)) {
    return 'Brevo blocked this server IP. Authorize it (or deactivate API IP lock) in Brevo → Security → Authorized IPs, then try again.';
  }
  if (status === 401) {
    return message || 'Brevo API key rejected. Check BREVO_API_KEY.';
  }
  if (status === 400 && /sender/i.test(message)) {
    return (
      message ||
      'Sender email is not verified in Brevo. Check BREVO_SENDER_EMAIL.'
    );
  }
  return (
    message ||
    `Brevo request failed (${status}). Check configuration and try again.`
  );
}

function firstNameFrom(toName: string | undefined, email: string): string {
  const fromName = (toName ?? '').trim().split(/\s+/)[0];
  if (fromName) return fromName.slice(0, 40);
  const local = email.split('@')[0]?.trim() || 'there';
  return local.slice(0, 40);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
