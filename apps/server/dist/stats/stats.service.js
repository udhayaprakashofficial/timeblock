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
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const scheduler_service_1 = require("../tasks/scheduler.service");
const local_data_store_1 = require("../auth/local-data.store");
const supabase_rest_service_1 = require("../supabase/supabase-rest.service");
const db_bridge_service_1 = require("../supabase/db-bridge.service");
const time_util_1 = require("../common/time.util");
const effort_badges_1 = require("./effort-badges");
let StatsService = class StatsService {
    prisma;
    scheduler;
    local;
    supabase;
    db;
    constructor(prisma, scheduler, local, supabase, db) {
        this.prisma = prisma;
        this.scheduler = scheduler;
        this.local = local;
        this.supabase = supabase;
        this.db = db;
    }
    async overview(userId, dateStr) {
        if (this.db.useDb()) {
            try {
                const id = await this.db.resolveUserId(userId);
                const day = (0, time_util_1.dateOnly)(dateStr);
                const weekStart = (0, time_util_1.startOfWeek)(day);
                const weekEnd = (0, time_util_1.addDays)(weekStart, 6);
                const todayTasks = await this.supabase.listTasks(id, dateStr);
                const weekTasks = await this.supabase.listTasksInRange(id, (0, time_util_1.formatDateOnly)(weekStart), (0, time_util_1.formatDateOnly)(weekEnd));
                const recentStart = (0, time_util_1.formatDateOnly)((0, time_util_1.addDays)(day, -13));
                const recentEnd = (0, time_util_1.formatDateOnly)(weekEnd);
                const recentTasks = await this.supabase.listTasksInRange(id, recentStart, recentEnd);
                const utilization = await this.utilizationFromTasks(id, dateStr, todayTasks);
                return {
                    today: this.counters(todayTasks),
                    week: this.counters(weekTasks),
                    utilization,
                    effort: (0, effort_badges_1.buildEffortSummary)({
                        date: dateStr,
                        todayTasks: this.asEffortTasks(todayTasks),
                        weekTasks: this.asEffortTasks(weekTasks),
                        recentTasks: this.asEffortTasks(recentTasks),
                        utilizationPercent: utilization.utilizationPercent,
                    }),
                };
            }
            catch (err) {
                console.warn('[stats] DB overview failed', err instanceof Error ? err.message : err);
            }
        }
        if (userId.startsWith('local_')) {
            return this.local.overview(userId, dateStr);
        }
        try {
            const day = (0, time_util_1.dateOnly)(dateStr);
            const weekStart = (0, time_util_1.startOfWeek)(day);
            const weekEnd = (0, time_util_1.addDays)(weekStart, 6);
            const todayTasks = await this.prisma.task.findMany({
                where: { userId, date: day },
            });
            const weekTasks = await this.prisma.task.findMany({
                where: {
                    userId,
                    date: { gte: weekStart, lte: weekEnd },
                },
            });
            const recentStart = (0, time_util_1.addDays)(day, -13);
            const recentTasks = await this.prisma.task.findMany({
                where: {
                    userId,
                    date: { gte: recentStart, lte: weekEnd },
                },
            });
            const utilization = await this.utilization(userId, dateStr);
            return {
                today: this.counters(todayTasks),
                week: this.counters(weekTasks),
                utilization,
                effort: (0, effort_badges_1.buildEffortSummary)({
                    date: dateStr,
                    todayTasks: this.asEffortTasks(todayTasks),
                    weekTasks: this.asEffortTasks(weekTasks),
                    recentTasks: this.asEffortTasks(recentTasks),
                    utilizationPercent: utilization.utilizationPercent,
                }),
            };
        }
        catch {
            return this.local.overview(userId, dateStr);
        }
    }
    async utilization(userId, dateStr) {
        if (this.db.useDb()) {
            try {
                const id = await this.db.resolveUserId(userId);
                const tasks = await this.supabase.listTasks(id, dateStr);
                return this.utilizationFromTasks(id, dateStr, tasks);
            }
            catch (err) {
                console.warn('[stats] DB utilization failed', err instanceof Error ? err.message : err);
            }
        }
        if (userId.startsWith('local_')) {
            return this.local.utilization(userId, dateStr);
        }
        try {
            const { availableMinutes } = await this.scheduler.getAvailableIntervals(userId, dateStr);
            const day = (0, time_util_1.dateOnly)(dateStr);
            const tasks = await this.prisma.task.findMany({
                where: { userId, date: day },
            });
            const scheduledMinutes = tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
            const utilizationPercent = availableMinutes === 0
                ? 0
                : Math.round((scheduledMinutes / availableMinutes) * 100);
            return {
                date: dateStr,
                availableMinutes,
                scheduledMinutes,
                utilizationPercent,
                tip: "Don't go over 80% utilization — leave room for ad-hoc tasks.",
            };
        }
        catch {
            return this.local.utilization(userId, dateStr);
        }
    }
    async weeklyReport(userId, dateStr) {
        if (this.db.useDb()) {
            try {
                const id = await this.db.resolveUserId(userId);
                const day = (0, time_util_1.dateOnly)(dateStr);
                const weekStart = (0, time_util_1.startOfWeek)(day);
                const weekEnd = (0, time_util_1.addDays)(weekStart, 6);
                const tasks = await this.supabase.listTasksInRange(id, (0, time_util_1.formatDateOnly)(weekStart), (0, time_util_1.formatDateOnly)(weekEnd));
                return this.buildWeekly((0, time_util_1.formatDateOnly)(weekStart), (0, time_util_1.formatDateOnly)(weekEnd), tasks.map((t) => ({
                    id: t.id,
                    name: t.name,
                    date: t.date,
                    estimatedMinutes: t.estimatedMinutes,
                    actualMinutes: t.actualMinutes ?? 0,
                    status: t.status,
                    scheduleLocked: Boolean(t.scheduleLocked),
                    scheduledStart: t.scheduledStart,
                    scheduledEnd: t.scheduledEnd,
                })));
            }
            catch (err) {
                console.warn('[stats] DB weekly failed', err instanceof Error ? err.message : err);
            }
        }
        if (userId.startsWith('local_')) {
            return this.local.weeklyReport(userId, dateStr);
        }
        try {
            const day = (0, time_util_1.dateOnly)(dateStr);
            const weekStart = (0, time_util_1.startOfWeek)(day);
            const weekEnd = (0, time_util_1.addDays)(weekStart, 6);
            const tasks = await this.prisma.task.findMany({
                where: {
                    userId,
                    date: { gte: weekStart, lte: weekEnd },
                },
                include: { timeEntries: true },
                orderBy: [{ date: 'asc' }, { order: 'asc' }],
            });
            return this.buildWeekly((0, time_util_1.formatDateOnly)(weekStart), (0, time_util_1.formatDateOnly)(weekEnd), tasks.map((t) => ({
                id: t.id,
                name: t.name,
                date: (0, time_util_1.formatDateOnly)(t.date),
                estimatedMinutes: t.estimatedMinutes,
                actualMinutes: t.timeEntries.reduce((sum, e) => sum + (e.actualMinutes ?? 0), 0),
                status: t.status,
                scheduleLocked: Boolean(t.scheduleLocked),
                scheduledStart: t.scheduledStart?.toISOString() ?? null,
                scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
            })));
        }
        catch {
            return this.local.weeklyReport(userId, dateStr);
        }
    }
    async eodSheet(userId, dateStr) {
        let tasks = [];
        if (this.db.useDb()) {
            try {
                const id = await this.db.resolveUserId(userId);
                const list = await this.supabase.listTasks(id, dateStr);
                tasks = list.map((t) => ({
                    id: t.id,
                    name: t.name,
                    date: t.date,
                    estimatedMinutes: t.estimatedMinutes,
                    actualMinutes: t.actualMinutes ?? 0,
                    status: t.status,
                    scheduleLocked: Boolean(t.scheduleLocked),
                    scheduledStart: t.scheduledStart,
                    scheduledEnd: t.scheduledEnd,
                    meetLink: t.meetLink ?? null,
                    notes: t.notes ?? null,
                }));
            }
            catch (err) {
                console.warn('[stats] DB eod failed', err instanceof Error ? err.message : err);
            }
        }
        if (!tasks.length && userId.startsWith('local_')) {
            return this.local.eodSheet(userId, dateStr);
        }
        if (!tasks.length) {
            try {
                const day = (0, time_util_1.dateOnly)(dateStr);
                const rows = await this.prisma.task.findMany({
                    where: { userId, date: day },
                    include: { timeEntries: true },
                    orderBy: { order: 'asc' },
                });
                tasks = rows.map((t) => ({
                    id: t.id,
                    name: t.name,
                    date: dateStr,
                    estimatedMinutes: t.estimatedMinutes,
                    actualMinutes: t.timeEntries.reduce((sum, e) => sum + (e.actualMinutes ?? 0), 0),
                    status: t.status,
                    scheduleLocked: Boolean(t.scheduleLocked),
                    scheduledStart: t.scheduledStart?.toISOString() ?? null,
                    scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
                    meetLink: t.meetLink ?? null,
                    notes: t.notes ?? null,
                }));
            }
            catch {
                return this.local.eodSheet(userId, dateStr);
            }
        }
        return this.buildEod(dateStr, tasks);
    }
    buildWeekly(weekStart, weekEnd, tasks) {
        const byDayMap = new Map();
        const start = (0, time_util_1.dateOnly)(weekStart);
        for (let i = 0; i < 7; i++) {
            const d = (0, time_util_1.formatDateOnly)((0, time_util_1.addDays)(start, i));
            byDayMap.set(d, {
                date: d,
                estimatedMinutes: 0,
                actualMinutes: 0,
                total: 0,
                completed: 0,
                pending: 0,
                completionPercent: 0,
            });
        }
        const byTask = tasks.map((t) => {
            const actualMinutes = t.actualMinutes ?? 0;
            const status = (t.status === 'completed'
                ? 'completed'
                : t.status === 'in_progress'
                    ? 'in_progress'
                    : 'pending');
            const bucket = byDayMap.get(t.date);
            if (bucket) {
                bucket.estimatedMinutes += t.estimatedMinutes;
                bucket.actualMinutes += actualMinutes;
                bucket.total += 1;
                if (status === 'completed')
                    bucket.completed += 1;
                else
                    bucket.pending += 1;
            }
            return {
                taskId: t.id,
                name: t.name,
                date: t.date,
                estimatedMinutes: t.estimatedMinutes,
                actualMinutes,
                status,
                varianceMinutes: actualMinutes - t.estimatedMinutes,
                scheduleLocked: Boolean(t.scheduleLocked),
                scheduledStart: t.scheduledStart ? String(t.scheduledStart) : null,
                scheduledEnd: t.scheduledEnd ? String(t.scheduledEnd) : null,
            };
        });
        const byDay = [...byDayMap.values()].map((d) => ({
            ...d,
            completionPercent: d.total === 0 ? 0 : Math.round((d.completed / d.total) * 100),
        }));
        const total = tasks.length;
        const completed = tasks.filter((t) => t.status === 'completed').length;
        const pending = total - completed;
        const totals = {
            estimatedMinutes: byDay.reduce((s, d) => s + d.estimatedMinutes, 0),
            actualMinutes: byDay.reduce((s, d) => s + d.actualMinutes, 0),
            total,
            completed,
            pending,
            completionPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
        };
        return { weekStart, weekEnd, byDay, byTask, totals };
    }
    buildEod(dateStr, tasks) {
        const rows = tasks.map((t) => {
            const status = (t.status === 'completed'
                ? 'completed'
                : t.status === 'in_progress'
                    ? 'in_progress'
                    : 'pending');
            const actualMinutes = t.actualMinutes ?? 0;
            return {
                id: t.id,
                name: t.name,
                status,
                estimatedMinutes: t.estimatedMinutes,
                actualMinutes,
                varianceMinutes: actualMinutes - t.estimatedMinutes,
                scheduledStart: t.scheduledStart ? String(t.scheduledStart) : null,
                scheduledEnd: t.scheduledEnd ? String(t.scheduledEnd) : null,
                scheduleLocked: Boolean(t.scheduleLocked),
                meetLink: t.meetLink ?? null,
                notes: t.notes ?? null,
            };
        });
        const total = rows.length;
        const completed = rows.filter((t) => t.status === 'completed').length;
        const inProgress = rows.filter((t) => t.status === 'in_progress').length;
        const pending = total - completed;
        return {
            date: dateStr,
            generatedAt: new Date().toISOString(),
            summary: {
                total,
                completed,
                pending,
                inProgress,
                estimatedMinutes: rows.reduce((s, t) => s + t.estimatedMinutes, 0),
                actualMinutes: rows.reduce((s, t) => s + t.actualMinutes, 0),
                completionPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
            },
            tasks: rows,
            shipped: rows.filter((t) => t.status === 'completed').map((t) => t.name),
            remaining: rows
                .filter((t) => t.status !== 'completed')
                .map((t) => t.name),
        };
    }
    async utilizationFromTasks(dbUserId, dateStr, tasks) {
        let availableMinutes = 8 * 60;
        try {
            const day = (0, time_util_1.dateOnly)(dateStr);
            const weekday = day.getUTCDay();
            const schedules = await this.supabase.listSchedule(dbUserId);
            const template = schedules.find((s) => s.weekday === weekday);
            if (template) {
                const [wsH, wsM] = template.workStart.split(':').map(Number);
                const [weH, weM] = template.workEnd.split(':').map(Number);
                availableMinutes = weH * 60 + weM - (wsH * 60 + wsM);
                for (const b of template.breaks) {
                    const [bsH, bsM] = b.start.split(':').map(Number);
                    const [beH, beM] = b.end.split(':').map(Number);
                    availableMinutes -= beH * 60 + beM - (bsH * 60 + bsM);
                }
                availableMinutes = Math.max(0, availableMinutes);
            }
        }
        catch {
            /* default 8h */
        }
        const scheduledMinutes = tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
        const utilizationPercent = availableMinutes === 0
            ? 0
            : Math.round((scheduledMinutes / availableMinutes) * 100);
        return {
            date: dateStr,
            availableMinutes,
            scheduledMinutes,
            utilizationPercent,
            tip: "Don't go over 80% utilization — leave room for ad-hoc tasks.",
        };
    }
    counters(tasks) {
        const completed = tasks.filter((t) => t.status === 'completed').length;
        return {
            total: tasks.length,
            completed,
            pending: tasks.length - completed,
        };
    }
    asEffortTasks(tasks) {
        return tasks.map((t) => ({
            date: typeof t.date === 'string'
                ? t.date.slice(0, 10)
                : (0, time_util_1.formatDateOnly)(t.date),
            name: t.name,
            status: t.status,
            estimatedMinutes: t.estimatedMinutes,
            actualMinutes: t.actualMinutes,
            scheduleLocked: t.scheduleLocked,
        }));
    }
};
exports.StatsService = StatsService;
exports.StatsService = StatsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        scheduler_service_1.SchedulerService,
        local_data_store_1.LocalDataStore,
        supabase_rest_service_1.SupabaseRestService,
        db_bridge_service_1.DbBridgeService])
], StatsService);
//# sourceMappingURL=stats.service.js.map