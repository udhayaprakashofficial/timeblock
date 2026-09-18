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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SchedulerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
exports.packTasks = packTasks;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const supabase_rest_service_1 = require("../supabase/supabase-rest.service");
const time_util_1 = require("../common/time.util");
/** Pure packer: place unlocked tasks into contiguous free slots; keep locked Meet/calendar tasks fixed. */
function packTasks(tasks, intervals, day, timeZone) {
    const locked = tasks.filter((t) => t.scheduleLocked && t.status !== 'completed');
    const pending = tasks.filter((t) => t.status !== 'completed' && !t.scheduleLocked);
    const completed = tasks.filter((t) => t.status === 'completed');
    const busyFixed = [];
    for (const t of [...completed, ...locked]) {
        if (t.scheduledStart && t.scheduledEnd) {
            const interval = (0, time_util_1.eventToMinutesOnDay)(day, new Date(t.scheduledStart), new Date(t.scheduledEnd), timeZone);
            if (interval)
                busyFixed.push(interval);
        }
    }
    let free = (0, time_util_1.subtractIntervals)(intervals, busyFixed);
    const result = [];
    for (const task of locked) {
        result.push({
            id: task.id,
            scheduledStart: task.scheduledStart
                ? new Date(task.scheduledStart)
                : null,
            scheduledEnd: task.scheduledEnd ? new Date(task.scheduledEnd) : null,
        });
    }
    for (const task of pending) {
        const need = Math.max(5, task.estimatedMinutes);
        let placed = null;
        for (let i = 0; i < free.length; i++) {
            const slot = free[i];
            if (slot.end - slot.start >= need) {
                placed = { start: slot.start, end: slot.start + need };
                free = [
                    ...free.slice(0, i),
                    ...(slot.start + need < slot.end
                        ? [{ start: slot.start + need, end: slot.end }]
                        : []),
                    ...free.slice(i + 1),
                ];
                break;
            }
        }
        result.push({
            id: task.id,
            scheduledStart: placed
                ? (0, time_util_1.combineDateAndMinutes)(day, placed.start, timeZone)
                : null,
            scheduledEnd: placed
                ? (0, time_util_1.combineDateAndMinutes)(day, placed.end, timeZone)
                : null,
        });
    }
    return result;
}
let SchedulerService = SchedulerService_1 = class SchedulerService {
    prisma;
    supabase;
    logger = new common_1.Logger(SchedulerService_1.name);
    constructor(prisma, supabase) {
        this.prisma = prisma;
        this.supabase = supabase;
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
            /* REST fallback */
        }
        if (this.supabase?.isConfigured()) {
            const user = await this.supabase.getUserById(userId);
            if (user?.timezone)
                return (0, time_util_1.normalizeTimeZone)(user.timezone);
        }
        return 'UTC';
    }
    async getAvailableIntervals(userId, dateStr) {
        try {
            return await this.getAvailablePrisma(userId, dateStr);
        }
        catch (err) {
            if (this.supabase?.isConfigured()) {
                return this.getAvailableRest(userId, dateStr);
            }
            throw err;
        }
    }
    async rescheduleDay(userId, dateStr) {
        try {
            await this.reschedulePrisma(userId, dateStr);
            return;
        }
        catch (err) {
            this.logger.warn(`Prisma reschedule failed, trying REST: ${err instanceof Error ? err.message : err}`);
        }
        if (this.supabase?.isConfigured()) {
            await this.rescheduleRest(userId, dateStr);
        }
    }
    /** Force REST packing (used after REST task create/reorder). */
    async rescheduleDayPreferRest(userId, dateStr) {
        if (this.supabase?.isConfigured()) {
            try {
                await this.rescheduleRest(userId, dateStr);
                return;
            }
            catch (err) {
                this.logger.warn(`REST reschedule failed: ${err instanceof Error ? err.message : err}`);
            }
        }
        await this.rescheduleDay(userId, dateStr);
    }
    async getAvailablePrisma(userId, dateStr) {
        const day = (0, time_util_1.dateOnly)(dateStr);
        const weekday = day.getUTCDay();
        const timeZone = await this.resolveTimeZone(userId);
        const template = await this.prisma.dailyScheduleTemplate.findUnique({
            where: { userId_weekday: { userId, weekday } },
            include: { breaks: true },
        });
        if (!template) {
            return { intervals: [], availableMinutes: 0 };
        }
        let available = [
            {
                start: (0, time_util_1.parseHm)(template.workStart),
                end: (0, time_util_1.parseHm)(template.workEnd),
            },
        ];
        const breakBusy = template.breaks.map((b) => ({
            start: (0, time_util_1.parseHm)(b.start),
            end: (0, time_util_1.parseHm)(b.end),
        }));
        available = (0, time_util_1.subtractIntervals)(available, breakBusy);
        const { start: dayStart, end: dayEnd } = (0, time_util_1.dayBoundsInTimeZone)(dateStr, timeZone);
        const events = await this.prisma.calendarEvent.findMany({
            where: {
                userId,
                start: { lt: dayEnd },
                end: { gt: dayStart },
            },
        });
        const eventBusy = [];
        for (const ev of events) {
            const interval = (0, time_util_1.eventToMinutesOnDay)(day, ev.start, ev.end, timeZone);
            if (interval)
                eventBusy.push(interval);
        }
        available = (0, time_util_1.subtractIntervals)(available, eventBusy);
        const availableMinutes = available.reduce((sum, i) => sum + (i.end - i.start), 0);
        return { intervals: available, availableMinutes };
    }
    async getAvailableRest(userId, dateStr) {
        const day = (0, time_util_1.dateOnly)(dateStr);
        const weekday = day.getUTCDay();
        const timeZone = await this.resolveTimeZone(userId);
        const schedules = await this.supabase.listSchedule(userId);
        const template = schedules.find((s) => s.weekday === weekday);
        if (!template) {
            return { intervals: [], availableMinutes: 0 };
        }
        let available = [
            {
                start: (0, time_util_1.parseHm)(template.workStart),
                end: (0, time_util_1.parseHm)(template.workEnd),
            },
        ];
        const breakBusy = template.breaks.map((b) => ({
            start: (0, time_util_1.parseHm)(b.start),
            end: (0, time_util_1.parseHm)(b.end),
        }));
        available = (0, time_util_1.subtractIntervals)(available, breakBusy);
        try {
            const events = await this.supabase.listCalendarEvents(userId, dateStr, timeZone);
            const eventBusy = [];
            for (const ev of events) {
                const interval = (0, time_util_1.eventToMinutesOnDay)(day, new Date(ev.start), new Date(ev.end), timeZone);
                if (interval)
                    eventBusy.push(interval);
            }
            available = (0, time_util_1.subtractIntervals)(available, eventBusy);
        }
        catch {
            /* calendar optional on REST */
        }
        const availableMinutes = available.reduce((sum, i) => sum + (i.end - i.start), 0);
        return { intervals: available, availableMinutes };
    }
    async reschedulePrisma(userId, dateStr) {
        const day = (0, time_util_1.dateOnly)(dateStr);
        const timeZone = await this.resolveTimeZone(userId);
        const { intervals } = await this.getAvailablePrisma(userId, dateStr);
        const tasks = await this.prisma.task.findMany({
            where: { userId, date: day, inBacklog: false },
            orderBy: { order: 'asc' },
        });
        const packed = packTasks(tasks, intervals, dateStr, timeZone);
        for (const p of packed) {
            const task = tasks.find((t) => t.id === p.id);
            const unplaced = task &&
                !task.scheduleLocked &&
                task.status !== 'completed' &&
                !p.scheduledStart;
            if (unplaced) {
                await this.prisma.task.update({
                    where: { id: p.id },
                    data: {
                        inBacklog: true,
                        scheduledStart: null,
                        scheduledEnd: null,
                        scheduleLocked: false,
                    },
                });
                continue;
            }
            await this.prisma.task.update({
                where: { id: p.id },
                data: {
                    scheduledStart: p.scheduledStart,
                    scheduledEnd: p.scheduledEnd,
                },
            });
        }
    }
    async rescheduleRest(userId, dateStr) {
        const timeZone = await this.resolveTimeZone(userId);
        const { intervals } = await this.getAvailableRest(userId, dateStr);
        const tasks = (await this.supabase.listTasks(userId, dateStr)).filter((t) => !t.inBacklog);
        const packed = packTasks(tasks, intervals, dateStr, timeZone);
        const now = new Date().toISOString();
        for (const p of packed) {
            const task = tasks.find((t) => t.id === p.id);
            const unplaced = task &&
                !task.scheduleLocked &&
                task.status !== 'completed' &&
                !p.scheduledStart;
            if (unplaced) {
                await this.supabase.patch('Task', `id=eq.${p.id}`, {
                    inBacklog: true,
                    scheduledStart: null,
                    scheduledEnd: null,
                    scheduleLocked: false,
                    updatedAt: now,
                });
                continue;
            }
            await this.supabase.patch('Task', `id=eq.${p.id}`, {
                scheduledStart: p.scheduledStart?.toISOString() ?? null,
                scheduledEnd: p.scheduledEnd?.toISOString() ?? null,
                updatedAt: now,
            });
        }
    }
};
exports.SchedulerService = SchedulerService;
exports.SchedulerService = SchedulerService = SchedulerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        supabase_rest_service_1.SupabaseRestService])
], SchedulerService);
//# sourceMappingURL=scheduler.service.js.map