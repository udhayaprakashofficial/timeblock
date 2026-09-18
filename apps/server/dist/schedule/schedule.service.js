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
exports.ScheduleTemplatesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const scheduler_service_1 = require("../tasks/scheduler.service");
const local_data_store_1 = require("../auth/local-data.store");
const supabase_rest_service_1 = require("../supabase/supabase-rest.service");
const db_bridge_service_1 = require("../supabase/db-bridge.service");
const time_util_1 = require("../common/time.util");
let ScheduleTemplatesService = class ScheduleTemplatesService {
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
    async viaDb(userId, fn) {
        if (!this.db.useDb())
            return null;
        try {
            const id = await this.db.resolveUserId(userId);
            return await fn(id);
        }
        catch (err) {
            console.warn('[schedule] DB failed', err instanceof Error ? err.message : err);
            return null;
        }
    }
    async rescheduleAfter(dbUserId) {
        let tz = 'UTC';
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: dbUserId },
                select: { timezone: true },
            });
            if (user?.timezone)
                tz = (0, time_util_1.normalizeTimeZone)(user.timezone);
        }
        catch {
            if (this.supabase.isConfigured()) {
                const user = await this.supabase.getUserById(dbUserId);
                if (user?.timezone)
                    tz = (0, time_util_1.normalizeTimeZone)(user.timezone);
            }
        }
        const todayStr = (0, time_util_1.todayInTimeZone)(tz);
        for (let i = 0; i < 7; i++) {
            const [y, m, d] = todayStr.split('-').map(Number);
            const next = new Date(Date.UTC(y, m - 1, d + i));
            const dateStr = (0, time_util_1.formatDateOnly)(next);
            try {
                await this.scheduler.rescheduleDayPreferRest(dbUserId, dateStr);
            }
            catch {
                /* ignore */
            }
        }
    }
    async list(userId) {
        const fromDb = await this.viaDb(userId, (id) => this.supabase.listSchedule(id));
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.listSchedule(userId);
        }
        try {
            const rows = await this.prisma.dailyScheduleTemplate.findMany({
                where: { userId },
                include: { breaks: true },
                orderBy: { weekday: 'asc' },
            });
            return rows.map((r) => this.map(r));
        }
        catch {
            return this.local.listSchedule(userId);
        }
    }
    async upsert(userId, dto) {
        const fromDb = await this.viaDb(userId, async (id) => {
            const row = await this.supabase.upsertSchedule(id, dto);
            await this.rescheduleAfter(id);
            return row;
        });
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.upsertSchedule(userId, dto);
        }
        try {
            const result = await this.writeTemplate(userId, dto);
            await this.rescheduleUpcoming(userId);
            return result;
        }
        catch {
            return this.local.upsertSchedule(userId, dto);
        }
    }
    async applyToAllDays(userId, dto) {
        const fromDb = await this.viaDb(userId, async (id) => {
            const weekdays = [0, 1, 2, 3, 4, 5, 6];
            for (const weekday of weekdays) {
                await this.supabase.upsertSchedule(id, { ...dto, weekday });
            }
            await this.rescheduleAfter(id);
            return this.supabase.listSchedule(id);
        });
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.applyScheduleToAll(userId, dto);
        }
        try {
            const weekdays = [0, 1, 2, 3, 4, 5, 6];
            for (const weekday of weekdays) {
                await this.writeTemplate(userId, { ...dto, weekday });
            }
            await this.rescheduleUpcoming(userId);
            return this.list(userId);
        }
        catch {
            return this.local.applyScheduleToAll(userId, dto);
        }
    }
    async writeTemplate(userId, dto) {
        const existing = await this.prisma.dailyScheduleTemplate.findUnique({
            where: {
                userId_weekday: { userId, weekday: dto.weekday },
            },
        });
        if (existing) {
            await this.prisma.break.deleteMany({ where: { templateId: existing.id } });
            const updated = await this.prisma.dailyScheduleTemplate.update({
                where: { id: existing.id },
                data: {
                    workStart: dto.workStart,
                    workEnd: dto.workEnd,
                    breaks: {
                        create: dto.breaks.map((b) => ({
                            name: b.name,
                            start: b.start,
                            end: b.end,
                        })),
                    },
                },
                include: { breaks: true },
            });
            return this.map(updated);
        }
        const created = await this.prisma.dailyScheduleTemplate.create({
            data: {
                userId,
                weekday: dto.weekday,
                workStart: dto.workStart,
                workEnd: dto.workEnd,
                breaks: {
                    create: dto.breaks.map((b) => ({
                        name: b.name,
                        start: b.start,
                        end: b.end,
                    })),
                },
            },
            include: { breaks: true },
        });
        return this.map(created);
    }
    async rescheduleUpcoming(userId) {
        const today = new Date();
        for (let i = 0; i < 7; i++) {
            const d = (0, time_util_1.formatDateOnly)((0, time_util_1.addDays)(today, i));
            try {
                await this.scheduler.rescheduleDay(userId, d);
            }
            catch {
                /* skip when Prisma down */
            }
        }
    }
    map(r) {
        return {
            id: r.id,
            weekday: r.weekday,
            workStart: r.workStart,
            workEnd: r.workEnd,
            breaks: r.breaks.map((b) => ({
                id: b.id,
                name: b.name,
                start: b.start,
                end: b.end,
            })),
        };
    }
};
exports.ScheduleTemplatesService = ScheduleTemplatesService;
exports.ScheduleTemplatesService = ScheduleTemplatesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        scheduler_service_1.SchedulerService,
        local_data_store_1.LocalDataStore,
        supabase_rest_service_1.SupabaseRestService,
        db_bridge_service_1.DbBridgeService])
], ScheduleTemplatesService);
//# sourceMappingURL=schedule.service.js.map