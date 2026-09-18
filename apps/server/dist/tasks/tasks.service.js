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
exports.TasksService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const scheduler_service_1 = require("./scheduler.service");
const local_data_store_1 = require("../auth/local-data.store");
const supabase_rest_service_1 = require("../supabase/supabase-rest.service");
const db_bridge_service_1 = require("../supabase/db-bridge.service");
const time_util_1 = require("../common/time.util");
let TasksService = class TasksService {
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
            console.warn('[tasks] DB write failed', err instanceof Error ? err.message : err);
            return null;
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
            /* REST fallback */
        }
        if (this.supabase.isConfigured()) {
            const user = await this.supabase.getUserById(userId);
            if (user?.timezone)
                return (0, time_util_1.normalizeTimeZone)(user.timezone);
        }
        return 'UTC';
    }
    async resolveDefaultMinutes(userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { defaultTaskMinutes: true },
            });
            if (user?.defaultTaskMinutes && user.defaultTaskMinutes >= 5) {
                return user.defaultTaskMinutes;
            }
        }
        catch {
            /* REST fallback */
        }
        if (this.supabase.isConfigured()) {
            try {
                const rows = await this.supabase.select('User', 'defaultTaskMinutes', { filter: `id=eq.${userId}`, limit: 1 });
                const n = Number(rows[0]?.defaultTaskMinutes);
                if (Number.isFinite(n) && n >= 5)
                    return Math.round(n);
            }
            catch {
                /* column may not exist yet */
            }
        }
        return 30;
    }
    async resolveCreatePayload(userId, dto) {
        const name = dto.name?.trim();
        if (!name) {
            throw new common_1.BadRequestException('Task name is required');
        }
        const startTime = dto.startTime?.trim();
        const endTime = dto.endTime?.trim();
        if (startTime || endTime) {
            if (!startTime || !endTime) {
                throw new common_1.BadRequestException('Both start and end time are required');
            }
            let startMin;
            let endMin;
            try {
                startMin = (0, time_util_1.parseHm)(startTime);
                endMin = (0, time_util_1.parseHm)(endTime);
            }
            catch {
                throw new common_1.BadRequestException('Times must be HH:MM');
            }
            if (!(endMin > startMin)) {
                throw new common_1.BadRequestException('End time must be after start time');
            }
            const estimatedMinutes = endMin - startMin;
            if (estimatedMinutes < 5) {
                throw new common_1.BadRequestException('Slot must be at least 5 minutes');
            }
            const tz = await this.resolveTimeZone(userId);
            return {
                ...dto,
                name,
                estimatedMinutes,
                scheduledStart: (0, time_util_1.combineDateAndMinutes)(dto.date, startMin, tz),
                scheduledEnd: (0, time_util_1.combineDateAndMinutes)(dto.date, endMin, tz),
                scheduleLocked: true,
            };
        }
        let estimatedMinutes = dto.estimatedMinutes != null ? Number(dto.estimatedMinutes) : NaN;
        if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 5) {
            estimatedMinutes = await this.resolveDefaultMinutes(userId);
        }
        if (estimatedMinutes < 5) {
            throw new common_1.BadRequestException('Estimated minutes must be at least 5');
        }
        return {
            ...dto,
            name,
            estimatedMinutes: Math.round(estimatedMinutes),
            scheduledStart: null,
            scheduledEnd: null,
            scheduleLocked: false,
        };
    }
    /** Move unfinished non-meeting tasks from past days into the backlog. */
    async carryOverUnfinished(userId) {
        const tz = await this.resolveTimeZone(userId);
        const today = (0, time_util_1.todayInTimeZone)(tz);
        const fromDb = await this.viaDb(userId, async (id) => {
            return this.supabase.carryOverUnfinished(id, today);
        });
        if (fromDb != null)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.carryOverUnfinished(userId, today);
        }
        try {
            const result = await this.prisma.task.updateMany({
                where: {
                    userId,
                    inBacklog: false,
                    scheduleLocked: false,
                    status: { in: ['pending', 'in_progress'] },
                    date: { lt: (0, time_util_1.dateOnly)(today) },
                },
                data: {
                    inBacklog: true,
                    scheduledStart: null,
                    scheduledEnd: null,
                },
            });
            return result.count;
        }
        catch {
            return this.local.carryOverUnfinished(userId, today);
        }
    }
    async list(userId, dateStr) {
        await this.carryOverUnfinished(userId);
        const fromDb = await this.viaDb(userId, (id) => this.supabase.listTasks(id, dateStr));
        if (fromDb)
            return fromDb.filter((t) => !t.inBacklog);
        if (userId.startsWith('local_')) {
            return this.local.listTasks(userId, dateStr);
        }
        try {
            const day = (0, time_util_1.dateOnly)(dateStr);
            const tasks = await this.prisma.task.findMany({
                where: { userId, date: day, inBacklog: false },
                include: { timeEntries: true },
                orderBy: { order: 'asc' },
            });
            return tasks.map((t) => this.mapTask(t));
        }
        catch {
            return this.local.listTasks(userId, dateStr);
        }
    }
    async listBacklog(userId) {
        await this.carryOverUnfinished(userId);
        const fromDb = await this.viaDb(userId, (id) => this.supabase.listBacklogTasks(id));
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.listBacklog(userId);
        }
        try {
            const tasks = await this.prisma.task.findMany({
                where: {
                    userId,
                    inBacklog: true,
                    status: { in: ['pending', 'in_progress'] },
                },
                include: { timeEntries: true },
                orderBy: [{ date: 'asc' }, { order: 'asc' }],
            });
            return tasks.map((t) => this.mapTask(t));
        }
        catch {
            return this.local.listBacklog(userId);
        }
    }
    async create(userId, dto) {
        let tzUserId = userId;
        if (this.db.useDb()) {
            try {
                tzUserId = await this.db.resolveUserId(userId);
            }
            catch {
                /* keep session id */
            }
        }
        const payload = await this.resolveCreatePayload(tzUserId, dto);
        const fromDb = await this.viaDb(userId, async (id) => {
            const created = await this.supabase.createTask(id, {
                date: payload.date,
                name: payload.name,
                estimatedMinutes: payload.estimatedMinutes,
                scheduledStart: payload.scheduledStart?.toISOString() ?? null,
                scheduledEnd: payload.scheduledEnd?.toISOString() ?? null,
                scheduleLocked: payload.scheduleLocked,
                inBacklog: false,
            });
            await this.scheduler.rescheduleDayPreferRest(id, payload.date);
            const list = await this.supabase.listTasks(id, payload.date);
            const backlog = await this.supabase.listBacklogTasks(id);
            return (list.find((t) => t.id === created.id) ??
                backlog.find((t) => t.id === created.id) ??
                list.find((t) => t.name === payload.name && t.date === payload.date) ??
                created);
        });
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.createTask(userId, payload);
        }
        try {
            const day = (0, time_util_1.dateOnly)(payload.date);
            const max = await this.prisma.task.aggregate({
                where: { userId, date: day, inBacklog: false },
                _max: { order: true },
            });
            const order = (max._max.order ?? -1) + 1;
            const task = await this.prisma.task.create({
                data: {
                    userId,
                    date: day,
                    name: payload.name,
                    estimatedMinutes: payload.estimatedMinutes,
                    order,
                    scheduledStart: payload.scheduledStart,
                    scheduledEnd: payload.scheduledEnd,
                    scheduleLocked: payload.scheduleLocked,
                    inBacklog: false,
                },
                include: { timeEntries: true },
            });
            await this.scheduler.rescheduleDay(userId, payload.date);
            const refreshed = await this.prisma.task.findUnique({
                where: { id: task.id },
                include: { timeEntries: true },
            });
            return this.mapTask(refreshed);
        }
        catch {
            return this.local.createTask(userId, payload);
        }
    }
    async scheduleFromBacklog(userId, taskId, dto = {}) {
        const tz = await this.resolveTimeZone((await this.viaDb(userId, async (id) => id)) ?? userId);
        const dateStr = dto.date?.trim() || (0, time_util_1.todayInTimeZone)(tz);
        const fromDb = await this.viaDb(userId, async (id) => {
            const task = await this.supabase.scheduleFromBacklog(id, taskId, dateStr);
            await this.scheduler.rescheduleDayPreferRest(id, dateStr);
            const list = await this.supabase.listTasks(id, dateStr);
            const backlog = await this.supabase.listBacklogTasks(id);
            return (list.find((t) => t.id === taskId) ??
                backlog.find((t) => t.id === taskId) ??
                task);
        });
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.scheduleFromBacklog(userId, taskId, dateStr);
        }
        try {
            const existing = await this.prisma.task.findFirst({
                where: { id: taskId, userId },
            });
            if (!existing)
                throw new common_1.NotFoundException('Task not found');
            if (existing.status === 'completed') {
                throw new common_1.BadRequestException('Completed tasks cannot be rescheduled from backlog');
            }
            const day = (0, time_util_1.dateOnly)(dateStr);
            const max = await this.prisma.task.aggregate({
                where: { userId, date: day, inBacklog: false },
                _max: { order: true },
            });
            await this.prisma.task.update({
                where: { id: taskId },
                data: {
                    date: day,
                    inBacklog: false,
                    scheduleLocked: false,
                    scheduledStart: null,
                    scheduledEnd: null,
                    order: (max._max.order ?? -1) + 1,
                    status: existing.status === 'in_progress' ? 'in_progress' : 'pending',
                },
            });
            await this.scheduler.rescheduleDay(userId, dateStr);
            const refreshed = await this.prisma.task.findUnique({
                where: { id: taskId },
                include: { timeEntries: true },
            });
            return this.mapTask(refreshed);
        }
        catch (err) {
            if (err instanceof common_1.NotFoundException || err instanceof common_1.BadRequestException) {
                throw err;
            }
            return this.local.scheduleFromBacklog(userId, taskId, dateStr);
        }
    }
    async moveToBacklog(userId, taskId) {
        return this.update(userId, taskId, { inBacklog: true });
    }
    async reorder(userId, dateStr, taskIds) {
        const fromDb = await this.viaDb(userId, async (id) => {
            for (let i = 0; i < taskIds.length; i++) {
                await this.supabase.patch('Task', `id=eq.${taskIds[i]}&userId=eq.${id}`, { order: i, updatedAt: new Date().toISOString() });
            }
            await this.scheduler.rescheduleDayPreferRest(id, dateStr);
            return this.supabase.listTasks(id, dateStr);
        });
        if (fromDb)
            return fromDb.filter((t) => !t.inBacklog);
        if (userId.startsWith('local_')) {
            return this.local.reorderTasks(userId, dateStr, taskIds);
        }
        try {
            const day = (0, time_util_1.dateOnly)(dateStr);
            await this.prisma.$transaction(taskIds.map((id, index) => this.prisma.task.updateMany({
                where: { id, userId, date: day, inBacklog: false },
                data: { order: index },
            })));
            await this.scheduler.rescheduleDay(userId, dateStr);
            return this.list(userId, dateStr);
        }
        catch {
            return this.local.reorderTasks(userId, dateStr, taskIds);
        }
    }
    async complete(userId, taskId) {
        const fromDb = await this.viaDb(userId, async (id) => {
            const task = await this.supabase.completeTask(id, taskId);
            if (!task.inBacklog) {
                await this.scheduler.rescheduleDayPreferRest(id, task.date);
            }
            const list = await this.supabase.listTasks(id, task.date);
            return list.find((t) => t.id === taskId) ?? task;
        });
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.completeTask(userId, taskId);
        }
        try {
            const task = await this.prisma.task.findFirst({
                where: { id: taskId, userId },
            });
            if (!task)
                throw new common_1.NotFoundException();
            const open = await this.prisma.timeEntry.findMany({
                where: { taskId, endedAt: null },
            });
            const now = new Date();
            for (const entry of open) {
                const actualMinutes = Math.max(1, Math.round((now.getTime() - entry.startedAt.getTime()) / 60000));
                await this.prisma.timeEntry.update({
                    where: { id: entry.id },
                    data: { endedAt: now, actualMinutes },
                });
            }
            await this.prisma.task.update({
                where: { id: taskId },
                data: { status: 'completed', inBacklog: false },
            });
            const dateStr = (0, time_util_1.formatDateOnly)(task.date);
            if (!task.inBacklog) {
                await this.scheduler.rescheduleDay(userId, dateStr);
            }
            const refreshed = await this.prisma.task.findUnique({
                where: { id: taskId },
                include: { timeEntries: true },
            });
            return this.mapTask(refreshed);
        }
        catch (err) {
            if (err instanceof common_1.NotFoundException)
                throw err;
            return this.local.completeTask(userId, taskId);
        }
    }
    async remove(userId, taskId) {
        const fromDb = await this.viaDb(userId, async (id) => {
            const before = await this.supabase.select('Task', 'date,inBacklog', {
                filter: `id=eq.${taskId}&userId=eq.${id}`,
                limit: 1,
            });
            await this.supabase.deleteTask(id, taskId);
            if (before[0]?.date && !before[0].inBacklog) {
                await this.scheduler.rescheduleDayPreferRest(id, String(before[0].date).slice(0, 10));
            }
            return { ok: true };
        });
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.removeTask(userId, taskId);
        }
        try {
            const task = await this.prisma.task.findFirst({
                where: { id: taskId, userId },
            });
            if (!task)
                throw new common_1.NotFoundException();
            const dateStr = (0, time_util_1.formatDateOnly)(task.date);
            const wasBacklog = task.inBacklog;
            await this.prisma.task.delete({ where: { id: taskId } });
            if (!wasBacklog) {
                await this.scheduler.rescheduleDay(userId, dateStr);
            }
            return { ok: true };
        }
        catch (err) {
            if (err instanceof common_1.NotFoundException)
                throw err;
            return this.local.removeTask(userId, taskId);
        }
    }
    async update(userId, taskId, dto) {
        const hasField = dto.notes !== undefined ||
            dto.name !== undefined ||
            dto.estimatedMinutes !== undefined ||
            dto.startTime !== undefined ||
            dto.endTime !== undefined ||
            dto.unlockSchedule !== undefined ||
            dto.inBacklog !== undefined ||
            dto.date !== undefined ||
            dto.order !== undefined;
        if (!hasField) {
            throw new common_1.BadRequestException('Nothing to update');
        }
        let tzUserId = userId;
        if (this.db.useDb()) {
            try {
                tzUserId = await this.db.resolveUserId(userId);
            }
            catch {
                /* keep */
            }
        }
        const tz = await this.resolveTimeZone(tzUserId);
        const fromDb = await this.viaDb(userId, async (id) => {
            const updated = await this.supabase.updateTask(id, taskId, dto, tz);
            if (!updated.inBacklog) {
                await this.scheduler.rescheduleDayPreferRest(id, updated.date);
            }
            const list = await this.supabase.listTasks(id, updated.date);
            const backlog = await this.supabase.listBacklogTasks(id);
            return (list.find((t) => t.id === taskId) ??
                backlog.find((t) => t.id === taskId) ??
                updated);
        });
        if (fromDb)
            return fromDb;
        if (userId.startsWith('local_')) {
            return this.local.updateTask(userId, taskId, dto, tz);
        }
        try {
            const existing = await this.prisma.task.findFirst({
                where: { id: taskId, userId },
            });
            if (!existing)
                throw new common_1.NotFoundException('Task not found');
            const data = {};
            if (dto.name !== undefined) {
                const name = dto.name.trim();
                if (!name)
                    throw new common_1.BadRequestException('Task name is required');
                data.name = name;
            }
            if (dto.notes !== undefined) {
                data.notes =
                    dto.notes == null ? null : String(dto.notes).trim() || null;
            }
            if (dto.estimatedMinutes !== undefined) {
                const n = Number(dto.estimatedMinutes);
                if (!Number.isFinite(n) || n < 5) {
                    throw new common_1.BadRequestException('Estimated minutes must be at least 5');
                }
                data.estimatedMinutes = Math.round(n);
            }
            if (dto.order !== undefined) {
                data.order = Math.max(0, Math.round(Number(dto.order)));
            }
            if (dto.date !== undefined) {
                data.date = (0, time_util_1.dateOnly)(dto.date);
            }
            if (dto.inBacklog === true) {
                data.inBacklog = true;
                data.scheduledStart = null;
                data.scheduledEnd = null;
                data.scheduleLocked = false;
            }
            else if (dto.inBacklog === false) {
                data.inBacklog = false;
            }
            if (dto.unlockSchedule) {
                data.scheduleLocked = false;
                data.scheduledStart = null;
                data.scheduledEnd = null;
            }
            const startTime = dto.startTime === null ? null : dto.startTime?.trim() || undefined;
            const endTime = dto.endTime === null ? null : dto.endTime?.trim() || undefined;
            if (startTime || endTime) {
                if (!startTime || !endTime) {
                    throw new common_1.BadRequestException('Both start and end time are required');
                }
                const startMin = (0, time_util_1.parseHm)(startTime);
                const endMin = (0, time_util_1.parseHm)(endTime);
                if (!(endMin > startMin)) {
                    throw new common_1.BadRequestException('End time must be after start time');
                }
                const dateStr = dto.date ??
                    (data.date
                        ? (0, time_util_1.formatDateOnly)(data.date)
                        : (0, time_util_1.formatDateOnly)(existing.date));
                data.scheduledStart = (0, time_util_1.combineDateAndMinutes)(dateStr, startMin, tz);
                data.scheduledEnd = (0, time_util_1.combineDateAndMinutes)(dateStr, endMin, tz);
                data.scheduleLocked = true;
                data.estimatedMinutes = endMin - startMin;
                data.inBacklog = false;
            }
            const prevDate = (0, time_util_1.formatDateOnly)(existing.date);
            await this.prisma.task.update({
                where: { id: taskId },
                data,
            });
            const refreshed = await this.prisma.task.findUnique({
                where: { id: taskId },
                include: { timeEntries: true },
            });
            const next = this.mapTask(refreshed);
            if (!next.inBacklog) {
                await this.scheduler.rescheduleDay(userId, next.date);
            }
            if (prevDate !== next.date && !existing.inBacklog) {
                await this.scheduler.rescheduleDay(userId, prevDate);
            }
            return next;
        }
        catch (err) {
            if (err instanceof common_1.NotFoundException ||
                err instanceof common_1.BadRequestException) {
                throw err;
            }
            return this.local.updateTask(userId, taskId, dto, tz);
        }
    }
    mapTask(t) {
        const actualMinutes = t.timeEntries.reduce((sum, e) => sum + (e.actualMinutes ?? 0), 0);
        const active = t.timeEntries.find((e) => !e.endedAt);
        return {
            id: t.id,
            date: (0, time_util_1.formatDateOnly)(t.date),
            name: t.name,
            estimatedMinutes: t.estimatedMinutes,
            status: t.status,
            order: t.order,
            scheduledStart: t.scheduledStart?.toISOString() ?? null,
            scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
            actualMinutes,
            activeEntryId: active?.id ?? null,
            notes: t.notes ?? null,
            meetLink: t.meetLink ?? null,
            scheduleLocked: Boolean(t.scheduleLocked),
            sourceProvider: t.sourceProvider ?? null,
            inBacklog: Boolean(t.inBacklog),
        };
    }
};
exports.TasksService = TasksService;
exports.TasksService = TasksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        scheduler_service_1.SchedulerService,
        local_data_store_1.LocalDataStore,
        supabase_rest_service_1.SupabaseRestService,
        db_bridge_service_1.DbBridgeService])
], TasksService);
//# sourceMappingURL=tasks.service.js.map