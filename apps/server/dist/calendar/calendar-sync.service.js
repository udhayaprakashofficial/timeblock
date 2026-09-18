"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CalendarSyncService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarSyncService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const googleapis_1 = require("googleapis");
const prisma_service_1 = require("../prisma/prisma.service");
const auth_service_1 = require("../auth/auth.service");
const scheduler_service_1 = require("../tasks/scheduler.service");
const supabase_rest_service_1 = require("../supabase/supabase-rest.service");
const time_util_1 = require("../common/time.util");
const create_id_1 = require("../supabase/create-id");
function parseGraphDateTime(dateTime, _timeZone) {
    // Graph often returns local wall time without offset; treat as UTC-ish ISO if Z/offset present
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(dateTime)) {
        return new Date(dateTime);
    }
    return new Date(dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`);
}
function humanizeCalendarError(provider, raw) {
    if (/Calendar API has not been used|ACCESS_NOT_CONFIGURED|calendar-json.googleapis.com/i.test(raw)) {
        return ('Google Calendar API is disabled for this Cloud project. Enable it at ' +
            'https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=1021749382427 ' +
            'then wait 1–2 minutes and sync again.');
    }
    if (/invalid_grant|Token has been expired|invalid authentication/i.test(raw)) {
        return `Google access expired — reconnect Google Calendar in Settings.`;
    }
    return `${provider}: ${raw.slice(0, 280)}`;
}
function extractGoogleMeetLink(item) {
    if (item.hangoutLink)
        return item.hangoutLink;
    const video = item.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video' && e.uri);
    return video?.uri ?? null;
}
let CalendarSyncService = CalendarSyncService_1 = class CalendarSyncService {
    prisma;
    authService;
    scheduler;
    supabase;
    logger = new common_1.Logger(CalendarSyncService_1.name);
    constructor(prisma, authService, scheduler, supabase) {
        this.prisma = prisma;
        this.authService = authService;
        this.scheduler = scheduler;
        this.supabase = supabase;
    }
    async pollAllUsers() {
        let accounts = [];
        try {
            accounts = await this.prisma.oAuthAccount.findMany({
                select: { userId: true, provider: true },
            });
        }
        catch {
            if (this.supabase.isConfigured()) {
                const rows = await this.supabase.listOAuthAccounts();
                accounts = rows.map((r) => ({
                    userId: r.userId,
                    provider: r.provider,
                }));
            }
        }
        for (const account of accounts) {
            try {
                await this.syncUserProvider(account.userId, account.provider);
            }
            catch (err) {
                this.logger.warn(`Sync failed for ${account.userId}/${account.provider}: ${String(err)}`);
            }
        }
    }
    async resolveTimeZone(userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { timezone: true },
            });
            if (user?.timezone)
                return (0, time_util_1.normalizeTimeZone)(user.timezone);
        }
        catch {
            /* REST */
        }
        if (this.supabase.isConfigured()) {
            const user = await this.supabase.getUserById(userId);
            if (user?.timezone)
                return (0, time_util_1.normalizeTimeZone)(user.timezone);
        }
        return 'UTC';
    }
    async syncUserProvider(userId, provider) {
        if (provider === client_1.CalendarProvider.google) {
            await this.syncGoogle(userId);
        }
        else {
            await this.syncMicrosoft(userId);
        }
        const tz = await this.resolveTimeZone(userId);
        const today = (0, time_util_1.todayInTimeZone)(tz);
        await this.scheduler.rescheduleDay(userId, today);
    }
    async syncNow(userId) {
        let providers = [];
        try {
            const accounts = await this.prisma.oAuthAccount.findMany({
                where: { userId },
            });
            providers = accounts.map((a) => a.provider);
            if (!providers.length && this.supabase.isConfigured()) {
                const rows = await this.supabase.listOAuthAccounts(userId);
                providers = rows.map((r) => r.provider);
            }
        }
        catch {
            if (this.supabase.isConfigured()) {
                const rows = await this.supabase.listOAuthAccounts(userId);
                providers = rows.map((r) => r.provider);
            }
        }
        if (!providers.length) {
            throw new Error('No calendar connected. Click “Connect Google Calendar” first (enable offline access).');
        }
        const synced = [];
        const errors = [];
        for (const provider of providers) {
            try {
                await this.syncUserProvider(userId, provider);
                synced.push(provider);
            }
            catch (err) {
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
    async listEvents(userId, dateStr) {
        const tz = await this.resolveTimeZone(userId);
        try {
            const { start: day, end: dayEnd } = (0, time_util_1.dayBoundsInTimeZone)(dateStr, tz);
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
        }
        catch {
            if (!this.supabase.isConfigured())
                return [];
            return this.supabase.listCalendarEvents(userId, dateStr, tz);
        }
    }
    async saveEvent(input) {
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
        }
        catch (err) {
            console.warn('[calendar] Prisma saveEvent failed, trying REST', err instanceof Error ? err.message : err);
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
    async upsertCalendarTask(input) {
        const durationMs = input.end.getTime() - input.start.getTime();
        const estimatedMinutes = Math.max(1, Math.round(durationMs / 60_000));
        const tz = await this.resolveTimeZone(input.userId);
        const dateStr = (0, time_util_1.formatDateInTimeZone)(input.start, tz);
        const day = (0, time_util_1.dateOnly)(dateStr);
        const order = (0, time_util_1.minutesInTimeZone)(input.start, tz);
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
        }
        catch (err) {
            console.warn('[calendar] Prisma calendar→task upsert failed, trying REST', err instanceof Error ? err.message : err);
        }
        if (!this.supabase.isConfigured())
            return;
        const existing = await this.supabase.select('Task', 'id,status', {
            filter: `userId=eq.${input.userId}&sourceProvider=eq.${input.provider}&sourceExternalId=eq.${encodeURIComponent(input.externalId)}`,
            limit: 1,
        });
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
        }
        else {
            await this.supabase.insert('Task', {
                id: (0, create_id_1.createId)(),
                userId: input.userId,
                status: 'pending',
                createdAt: now,
                ...row,
            });
        }
    }
    async getGoogleClient(userId) {
        const tokens = await this.authService.getDecryptedTokens(userId, client_1.CalendarProvider.google);
        if (!tokens)
            return null;
        const oauth2 = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK_URL);
        oauth2.setCredentials({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken ?? undefined,
        });
        oauth2.on('tokens', async (t) => {
            if (t.access_token) {
                await this.authService.updateTokens(tokens.accountId, t.access_token, t.refresh_token, t.expiry_date ? new Date(t.expiry_date) : null);
            }
        });
        return oauth2;
    }
    async syncGoogle(userId) {
        const auth = await this.getGoogleClient(userId);
        if (!auth)
            return;
        const calendar = googleapis_1.google.calendar({ version: 'v3', auth });
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
        const seenIds = new Set();
        for (const item of items) {
            if (!item.id || item.status === 'cancelled')
                continue;
            const start = item.start?.dateTime || item.start?.date;
            const end = item.end?.dateTime || item.end?.date;
            if (!start || !end)
                continue;
            seenIds.add(item.id);
            const meetLink = extractGoogleMeetLink(item);
            const title = item.summary || (meetLink ? 'Google Meet' : 'Busy');
            await this.saveEvent({
                userId,
                provider: client_1.CalendarProvider.google,
                externalId: item.id,
                title,
                start: new Date(start),
                end: new Date(end),
                meetLink,
            });
        }
        await this.purgeMissingEvents(userId, client_1.CalendarProvider.google, timeMin, timeMax, seenIds);
    }
    async syncMicrosoft(userId) {
        const tokens = await this.authService.getDecryptedTokens(userId, client_1.CalendarProvider.microsoft);
        if (!tokens)
            return;
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
        url.searchParams.set('$select', 'id,subject,start,end,onlineMeeting,isOnlineMeeting');
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
            throw new Error(`Microsoft Graph error ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json());
        const seenIds = new Set();
        for (const item of data.value ?? []) {
            seenIds.add(item.id);
            const evStart = parseGraphDateTime(item.start.dateTime, item.start.timeZone);
            const evEnd = parseGraphDateTime(item.end.dateTime, item.end.timeZone);
            const meetLink = item.onlineMeeting?.joinUrl ?? null;
            await this.saveEvent({
                userId,
                provider: client_1.CalendarProvider.microsoft,
                externalId: item.id,
                title: item.subject || (meetLink ? 'Online meeting' : 'Busy'),
                start: evStart,
                end: evEnd,
                meetLink,
            });
        }
        await this.purgeMissingEvents(userId, client_1.CalendarProvider.microsoft, windowStart, windowEnd, seenIds);
    }
    async purgeMissingEvents(userId, provider, windowStart, windowEnd, seenIds) {
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
        }
        catch {
            /* skip purge when Prisma down */
        }
    }
    async refreshMicrosoft(tokens) {
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
        const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        if (!res.ok) {
            throw new Error(`Microsoft token refresh failed: ${await res.text()}`);
        }
        const json = (await res.json());
        await this.authService.updateTokens(tokens.accountId, json.access_token, json.refresh_token, new Date(Date.now() + json.expires_in * 1000));
        return json.access_token;
    }
};
exports.CalendarSyncService = CalendarSyncService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_5_MINUTES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CalendarSyncService.prototype, "pollAllUsers", null);
exports.CalendarSyncService = CalendarSyncService = CalendarSyncService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        auth_service_1.AuthService,
        scheduler_service_1.SchedulerService,
        supabase_rest_service_1.SupabaseRestService])
], CalendarSyncService);
//# sourceMappingURL=calendar-sync.service.js.map