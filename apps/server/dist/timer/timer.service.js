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
exports.TimerService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const tasks_service_1 = require("../tasks/tasks.service");
const local_data_store_1 = require("../auth/local-data.store");
const supabase_rest_service_1 = require("../supabase/supabase-rest.service");
const db_bridge_service_1 = require("../supabase/db-bridge.service");
let TimerService = class TimerService {
    prisma;
    tasksService;
    local;
    supabase;
    db;
    constructor(prisma, tasksService, local, supabase, db) {
        this.prisma = prisma;
        this.tasksService = tasksService;
        this.local = local;
        this.supabase = supabase;
        this.db = db;
    }
    async start(userId, taskId) {
        if (this.db.useDb()) {
            try {
                const id = await this.db.resolveUserId(userId);
                return await this.supabase.startTimer(id, taskId);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('not found'))
                    throw new common_1.NotFoundException('Task not found');
                if (msg.includes('already completed')) {
                    throw new common_1.BadRequestException('Task already completed');
                }
                if (msg.includes('already running')) {
                    throw new common_1.BadRequestException('Timer already running for this task');
                }
                console.warn('[timer] DB start failed', msg);
            }
        }
        if (userId.startsWith('local_')) {
            try {
                return this.local.startTimer(userId, taskId);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('already completed')) {
                    throw new common_1.BadRequestException('Task already completed');
                }
                if (msg.includes('already running')) {
                    throw new common_1.BadRequestException('Timer already running for this task');
                }
                throw new common_1.NotFoundException('Task not found');
            }
        }
        try {
            const task = await this.prisma.task.findFirst({
                where: { id: taskId, userId },
                include: { timeEntries: true },
            });
            if (!task)
                throw new common_1.NotFoundException('Task not found');
            if (task.status === 'completed') {
                throw new common_1.BadRequestException('Task already completed');
            }
            if (task.timeEntries.some((e) => !e.endedAt)) {
                throw new common_1.BadRequestException('Timer already running for this task');
            }
            await this.stopOtherOpenTimersPrisma(userId, taskId);
            await this.prisma.timeEntry.create({
                data: { taskId, startedAt: new Date() },
            });
            await this.prisma.task.update({
                where: { id: taskId },
                data: { status: 'in_progress' },
            });
            const date = task.date.toISOString().slice(0, 10);
            const tasks = await this.tasksService.list(userId, date);
            return tasks.find((t) => t.id === taskId);
        }
        catch (err) {
            if (err instanceof common_1.NotFoundException ||
                err instanceof common_1.BadRequestException) {
                throw err;
            }
            return this.local.startTimer(userId, taskId);
        }
    }
    async stop(userId, taskId) {
        if (this.db.useDb()) {
            try {
                const id = await this.db.resolveUserId(userId);
                return await this.supabase.stopTimer(id, taskId);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('not found'))
                    throw new common_1.NotFoundException('Task not found');
                if (msg.includes('No active')) {
                    throw new common_1.BadRequestException('No active timer');
                }
                console.warn('[timer] DB stop failed', msg);
            }
        }
        if (userId.startsWith('local_')) {
            try {
                return this.local.stopTimer(userId, taskId);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('No active')) {
                    throw new common_1.BadRequestException('No active timer');
                }
                throw new common_1.NotFoundException('Task not found');
            }
        }
        try {
            const task = await this.prisma.task.findFirst({
                where: { id: taskId, userId },
                include: { timeEntries: true },
            });
            if (!task)
                throw new common_1.NotFoundException('Task not found');
            const active = task.timeEntries.find((e) => !e.endedAt);
            if (!active)
                throw new common_1.BadRequestException('No active timer');
            const endedAt = new Date();
            const actualMinutes = Math.max(1, Math.round((endedAt.getTime() - active.startedAt.getTime()) / 60000));
            await this.prisma.timeEntry.update({
                where: { id: active.id },
                data: { endedAt, actualMinutes },
            });
            await this.prisma.task.update({
                where: { id: taskId },
                data: {
                    status: task.status === 'completed' ? 'completed' : 'pending',
                },
            });
            const date = task.date.toISOString().slice(0, 10);
            const tasks = await this.tasksService.list(userId, date);
            return tasks.find((t) => t.id === taskId);
        }
        catch (err) {
            if (err instanceof common_1.NotFoundException ||
                err instanceof common_1.BadRequestException) {
                throw err;
            }
            return this.local.stopTimer(userId, taskId);
        }
    }
    async stopOtherOpenTimersPrisma(userId, exceptTaskId) {
        const open = await this.prisma.timeEntry.findMany({
            where: {
                endedAt: null,
                task: { userId },
                NOT: { taskId: exceptTaskId },
            },
            include: { task: true },
        });
        const now = new Date();
        for (const entry of open) {
            const actualMinutes = Math.max(1, Math.round((now.getTime() - entry.startedAt.getTime()) / 60000));
            await this.prisma.timeEntry.update({
                where: { id: entry.id },
                data: { endedAt: now, actualMinutes },
            });
            if (entry.task.status !== 'completed') {
                await this.prisma.task.update({
                    where: { id: entry.taskId },
                    data: { status: 'pending' },
                });
            }
        }
    }
};
exports.TimerService = TimerService;
exports.TimerService = TimerService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        tasks_service_1.TasksService,
        local_data_store_1.LocalDataStore,
        supabase_rest_service_1.SupabaseRestService,
        db_bridge_service_1.DbBridgeService])
], TimerService);
//# sourceMappingURL=timer.service.js.map