import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CalendarProvider } from '@prisma/client';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SchedulerService } from '../tasks/scheduler.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { formatDateInTimeZone, dayBoundsInTimeZone, todayInTimeZone, minutesInTimeZone, normalizeTimeZone, dateOnly } from '../common/time.util';
import { createId } from '../supabase/create-id';

function parseGraphDateTime(dateTime: string, _timeZone?: string): Date {
  // Graph often returns local wall time without offset; treat as UTC-ish ISO if Z/offset present
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(dateTime)) {
    return new Date(dateTime);
  }
  return new Date(dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`);
}

function humanizeCalendarError(provider: string, raw: string): string {
  if (/Calendar API has not been used|ACCESS_NOT_CONFIGURED|calendar-json.googleapis.com/i.test(raw)) {
    return (
      'Google Calendar API is disabled for this Cloud project. Enable it at ' +
      'https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=1021749382427 ' +
      'then wait 1–2 minutes and sync again.'
    );
  }
  if (/invalid_grant|Token has been expired|invalid authentication/i.test(raw)) {
    return `Google access expired — reconnect Google Calendar in Settings.`;
  }
  return `${provider}: ${raw.slice(0, 280)}`;
}

function extractGoogleMeetLink(item: {
  hangoutLink?: string | null;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string | null; uri?: string | null }>;
  } | null;
}): string | null {
  if (item.hangoutLink) return item.hangoutLink;
  const video = item.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === 'video' && e.uri,
  );
  return video?.uri ?? null;
}

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly scheduler: SchedulerService,
    private readonly supabase: SupabaseRestService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollAllUsers() {
    let accounts: Array<{ userId: string; provider: CalendarProvider }> = [];
    try {
      accounts = await this.prisma.oAuthAccount.findMany({
        select: { userId: true, provider: true },
      });
    } catch {
      if (this.supabase.isConfigured()) {
        const rows = await this.supabase.listOAuthAccounts();
        accounts = rows.map((r) => ({
          userId: r.userId,
          provider: r.provider as CalendarProvider,
        }));
      }
    }
    for (const account of accounts) {
      try {
        await this.syncUserProvider(account.userId, account.provider);
      } catch (err) {
        this.logger.warn(
          `Sync failed for ${account.userId}/${account.provider}: ${String(err)}`,
        );
      }
    }
  }

  private async resolveTimeZone(userId: string): Promise<string> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      if (user?.timezone) return normalizeTimeZone(user.timezone);
    } catch {
      /* REST */
    }
    if (this.supabase.isConfigured()) {
      const user = await this.supabase.getUserById(userId);
      if (user?.timezone) return normalizeTimeZone(user.timezone);
    }
    return 'UTC';
  }

  async syncUserProvider(userId: string, provider: CalendarProvider) {
    if (provider === CalendarProvider.google) {
      await this.syncGoogle(userId);
    } else {
      await this.syncMicrosoft(userId);
    }
    const tz = await this.resolveTimeZone(userId);
    const today = todayInTimeZone(tz);
    await this.scheduler.rescheduleDay(userId, today);
  }

  async syncNow(userId: string) {
    let providers: CalendarProvider[] = [];
    try {
      const accounts = await this.prisma.oAuthAccount.findMany({
        where: { userId },
      });
      providers = accounts.map((a) => a.provider);
      if (!providers.length && this.supabase.isConfigured()) {
        const rows = await this.supabase.listOAuthAccounts(userId);
        providers = rows.map((r) => r.provider as CalendarProvider);
      }
    } catch {
      if (this.supabase.isConfigured()) {
        const rows = await this.supabase.listOAuthAccounts(userId);
        providers = rows.map((r) => r.provider as CalendarProvider);
      }
    }
    if (!providers.length) {
      throw new Error(
        'No calendar connected. Click “Connect Google Calendar” first (enable offline access).',
      );
    }
    const synced: string[] = [];
    const errors: string[] = [];
    for (const provider of providers) {
      try {
        await this.syncUserProvider(userId, provider);
        synced.push(provider);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sync failed for ${userId}/${provider}: ${msg}`);
        errors.push(humanizeCalendarError(provider, msg));
      }
    }
    if (!synced.length && errors.length) {
      throw new Error(errors.join(' · '));
    }
    return { synced, ...(errors.length ? { warning: errors.join(' · ') } : {}) };
  }

  async listEvents(userId: string, dateStr: string) {
    const tz = await this.resolveTimeZone(userId);
    try {
      const { start: day, end: dayEnd } = dayBoundsInTimeZone(dateStr, tz);
      const events = await this.prisma.calendarEvent.findMany({
        where: {
          userId,
          start: { lt: dayEnd },
          end: { gt: day },
        },
        orderBy: { start: 'asc' },
      });
      return events.map((e) => ({
        id: e.id,
        provider: e.provider,
        externalId: e.externalId,
        title: e.title,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        meetLink: e.meetLink ?? null,
      }));
    } catch {
      if (!this.supabase.isConfigured()) return [];
      return this.supabase.listCalendarEvents(userId, dateStr, tz);
    }
  }

  private async saveEvent(input: {
    userId: string;
    provider: CalendarProvider;
    externalId: string;
    title: string;
    start: Date;
    end: Date;
    meetLink: string | null;
  }) {
    try {
      await this.prisma.calendarEvent.upsert({
        where: {
          userId_provider_externalId: {
            userId: input.userId,
            provider: input.provider,
            externalId: input.externalId,
          },
        },
        create: {
          userId: input.userId,
          provider: input.provider,
          externalId: input.externalId,
          title: input.title,
          start: input.start,
          end: input.end,
          meetLink: input.meetLink,
        },
        update: {
          title: input.title,
          start: input.start,
          end: input.end,
          meetLink: input.meetLink,
        },
      });
    } catch (err) {
      console.warn(
        '[calendar] Prisma saveEvent failed, trying REST',
        err instanceof Error ? err.message : err,
      );
      if (this.supabase.isConfigured()) {
        await this.supabase.upsertCalendarEvent({
          userId: input.userId,
          provider: input.provider,
          externalId: input.externalId,
          title: input.title,
          start: input.start.toISOString(),
          end: input.end.toISOString(),
          meetLink: input.meetLink,
        });
      }
    }

    // Also materialize as a locked task so Meet/calls show in the task list
    await this.upsertCalendarTask(input);
  }

  /** Turn each calendar event into a fixed task (Google Meet / Outlook calls). */
  private async upsertCalendarTask(input: {
    userId: string;
    provider: CalendarProvider;
    externalId: string;
    title: string;
    start: Date;
    end: Date;
    meetLink: string | null;
  }) {
    const durationMs = input.end.getTime() - input.start.getTime();
    const estimatedMinutes = Math.max(1, Math.round(durationMs / 60_000));
    const tz = await this.resolveTimeZone(input.userId);
    const dateStr = formatDateInTimeZone(input.start, tz);
    const day = dateOnly(dateStr);
    const order = minutesInTimeZone(input.start, tz);

    try {
      await this.prisma.task.upsert({
        where: {
          userId_sourceProvider_sourceExternalId: {
            userId: input.userId,
            sourceProvider: input.provider,
            sourceExternalId: input.externalId,
          },
        },
        create: {
          userId: input.userId,
          date: day,
          name: input.title,
          estimatedMinutes,
          order,
          status: 'pending',
          scheduledStart: input.start,
          scheduledEnd: input.end,
          sourceProvider: input.provider,
          sourceExternalId: input.externalId,
          meetLink: input.meetLink,
          scheduleLocked: true,
        },
        update: {
          name: input.title,
          estimatedMinutes,
          order,
          scheduledStart: input.start,
          scheduledEnd: input.end,
          meetLink: input.meetLink,
          scheduleLocked: true,
          // Keep completed status if user already marked Done
        },
      });
      return;
    } catch (err) {
      console.warn(
        '[calendar] Prisma calendar→task upsert failed, trying REST',
        err instanceof Error ? err.message : err,
      );
    }

    if (!this.supabase.isConfigured()) return;
    const existing = await this.supabase.select<{ id: string; status: string }>(
      'Task',
      'id,status',
      {
        filter: `userId=eq.${input.userId}&sourceProvider=eq.${input.provider}&sourceExternalId=eq.${encodeURIComponent(input.externalId)}`,
        limit: 1,
      },
    );
    const now = new Date().toISOString();
    const row = {
      name: input.title,
      estimatedMinutes,
      order,
      date: dateStr,
      scheduledStart: input.start.toISOString(),
      scheduledEnd: input.end.toISOString(),
      meetLink: input.meetLink,
      scheduleLocked: true,
      sourceProvider: input.provider,
      sourceExternalId: input.externalId,
      updatedAt: now,
    };
    if (existing[0]) {
      await this.supabase.patch('Task', `id=eq.${existing[0].id}`, row);
    } else {
      await this.supabase.insert('Task', {
        id: createId(),
        userId: input.userId,
        status: 'pending',
        createdAt: now,
        ...row,
      });
    }
  }

  private async getGoogleClient(userId: string) {
    const tokens = await this.authService.getDecryptedTokens(
      userId,
      CalendarProvider.google,
    );
    if (!tokens) return null;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL,
    );
    oauth2.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken ?? undefined,
    });

    oauth2.on('tokens', async (t) => {
      if (t.access_token) {
        await this.authService.updateTokens(
          tokens.accountId,
          t.access_token,
          t.refresh_token,
          t.expiry_date ? new Date(t.expiry_date) : null,
        );
      }
    });

    return oauth2;
  }

  private async syncGoogle(userId: string) {
    const auth = await this.getGoogleClient(userId);
    if (!auth) return;

    const calendar = google.calendar({ version: 'v3', auth });
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - 1);
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 14);

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    const items = res.data.items ?? [];
    const seenIds = new Set<string>();
    for (const item of items) {
      if (!item.id || item.status === 'cancelled') continue;
      const start = item.start?.dateTime || item.start?.date;
      const end = item.end?.dateTime || item.end?.date;
      if (!start || !end) continue;
      seenIds.add(item.id);
      const meetLink = extractGoogleMeetLink(item);
      const title = item.summary || (meetLink ? 'Google Meet' : 'Busy');

      await this.saveEvent({
        userId,
        provider: CalendarProvider.google,
        externalId: item.id,
        title,
        start: new Date(start),
        end: new Date(end),
        meetLink,
      });
    }

    await this.purgeMissingEvents(
      userId,
      CalendarProvider.google,
      timeMin,
      timeMax,
      seenIds,
    );
  }

  private async syncMicrosoft(userId: string) {
    const tokens = await this.authService.getDecryptedTokens(
      userId,
      CalendarProvider.microsoft,
    );
    if (!tokens) return;

    let accessToken = tokens.accessToken;
    if (tokens.expiresAt && tokens.expiresAt.getTime() < Date.now() + 60_000) {
      accessToken = await this.refreshMicrosoft(tokens);
    }

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 1);
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 14);

    const url = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
    url.searchParams.set('startDateTime', windowStart.toISOString());
    url.searchParams.set('endDateTime', windowEnd.toISOString());
    url.searchParams.set('$top', '250');
    url.searchParams.set('$orderby', 'start/dateTime');
    url.searchParams.set(
      '$select',
      'id,subject,start,end,onlineMeeting,isOnlineMeeting',
    );

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Microsoft Graph error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      value: Array<{
        id: string;
        subject?: string;
        start: { dateTime: string; timeZone?: string };
        end: { dateTime: string; timeZone?: string };
        onlineMeeting?: { joinUrl?: string } | null;
        isOnlineMeeting?: boolean;
      }>;
    };

    const seenIds = new Set<string>();
    for (const item of data.value ?? []) {
      seenIds.add(item.id);
      const evStart = parseGraphDateTime(
        item.start.dateTime,
        item.start.timeZone,
      );
      const evEnd = parseGraphDateTime(item.end.dateTime, item.end.timeZone);
      const meetLink = item.onlineMeeting?.joinUrl ?? null;
      await this.saveEvent({
        userId,
        provider: CalendarProvider.microsoft,
        externalId: item.id,
        title: item.subject || (meetLink ? 'Online meeting' : 'Busy'),
        start: evStart,
        end: evEnd,
        meetLink,
      });
    }

    await this.purgeMissingEvents(
      userId,
      CalendarProvider.microsoft,
      windowStart,
      windowEnd,
      seenIds,
    );
  }

  private async purgeMissingEvents(
    userId: string,
    provider: CalendarProvider,
    windowStart: Date,
    windowEnd: Date,
    seenIds: Set<string>,
  ) {
    try {
      const existing = await this.prisma.calendarEvent.findMany({
        where: {
          userId,
          provider,
          start: { lt: windowEnd },
          end: { gt: windowStart },
        },
        select: { id: true, externalId: true },
      });
      const stale = existing.filter((e) => !seenIds.has(e.externalId));
      const toDelete = stale.map((e) => e.id);
      const staleExternal = stale.map((e) => e.externalId);
      if (toDelete.length) {
        await this.prisma.calendarEvent.deleteMany({
          where: { id: { in: toDelete } },
        });
      }
      if (staleExternal.length) {
        await this.prisma.task.deleteMany({
          where: {
            userId,
            sourceProvider: provider,
            sourceExternalId: { in: staleExternal },
            // Don't delete if user completed and we want to keep history — still remove orphaned meets
          },
        });
      }
    } catch {
      /* skip purge when Prisma down */
    }
  }

  private async refreshMicrosoft(tokens: {
    accountId: string;
    refreshToken: string | null;
  }): Promise<string> {
    if (!tokens.refreshToken) {
      throw new Error('Microsoft refresh token missing');
    }
    const body = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
      scope: 'user.read calendars.read offline_access',
    });
    const tenant = process.env.MICROSOFT_TENANT_ID ?? 'common';
    const res = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!res.ok) {
      throw new Error(`Microsoft token refresh failed: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    await this.authService.updateTokens(
      tokens.accountId,
      json.access_token,
      json.refresh_token,
      new Date(Date.now() + json.expires_in * 1000),
    );
    return json.access_token;
  }
}
