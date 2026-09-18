"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalDataStore = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const time_util_1 = require("../common/time.util");
const effort_badges_1 = require("../stats/effort-badges");
let LocalDataStore = class LocalDataStore {
    dir = (0, path_1.resolve)(__dirname, '../../data');
    file = (0, path_1.resolve)(this.dir, 'local-app.json');
    read() {
        if (!(0, fs_1.existsSync)(this.file))
            return { tasks: [], schedules: [] };
        try {
            return JSON.parse((0, fs_1.readFileSync)(this.file, 'utf8'));
        }
        catch {
            return { tasks: [], schedules: [] };
        }
    }
    write(data) {
        if (!(0, fs_1.existsSync)(this.dir))
            (0, fs_1.mkdirSync)(this.dir, { recursive: true });
        (0, fs_1.writeFileSync)(this.file, JSON.stringify(data, null, 2), 'utf8');
    }
    ensureDefaultSchedule(userId) {
        const db = this.read();
        const existing = db.schedules.filter((s) => s.userId === userId);
        if (existing.length)
            return;
        const weekdays = [1, 2, 3, 4, 5];
        for (const weekday of weekdays) {
            db.schedules.push({
                id: `ltpl_${(0, crypto_1.randomBytes)(6).toString('hex')}`,
                userId,
                weekday,
                workStart: '09:00',
                workEnd: '18:00',
                breaks: [
                    {
                        id: `lbr_${(0, crypto_1.randomBytes)(4).toString('hex')}`,
                        name: 'Lunch',
                        start: '12:00',
                        end: '13:00',
                    },
                ],
            });
        }
        this.write(db);
    }
    listSchedule(userId) {
        this.ensureDefaultSchedule(userId);
        return this.read()
            .schedules.filter((s) => s.userId === userId)
            .sort((a, b) => a.weekday - b.weekday)
            .map((s) => ({
            id: s.id,
            weekday: s.weekday,
            workStart: s.workStart,
            workEnd: s.workEnd,
            breaks: s.breaks.map((b) => ({ ...b })),
        }));
    }
    upsertSchedule(userId, dto) {
        const db = this.read();
        let row = db.schedules.find((s) => s.userId === userId && s.weekday === dto.weekday);
        if (!row) {
            row = {
                id: `ltpl_${(0, crypto_1.randomBytes)(6).toString('hex')}`,
                userId,
                weekday: dto.weekday,
                workStart: dto.workStart,
                workEnd: dto.workEnd,
                breaks: [],
            };
            db.schedules.push(row);
        }
        row.workStart = dto.workStart;
        row.workEnd = dto.workEnd;
        row.breaks = dto.breaks.map((b) => ({
            id: `lbr_${(0, crypto_1.randomBytes)(4).toString('hex')}`,
            name: b.name,
            start: b.start,
            end: b.end,
        }));
        this.write(db);
        this.rescheduleUpcoming(userId);
        return {
            id: row.id,
            weekday: row.weekday,
            workStart: row.workStart,
            workEnd: row.workEnd,
            breaks: row.breaks.map((b) => ({ ...b })),
        };
    }
    applyScheduleToAll(userId, dto) {
        for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
            this.upsertSchedule(userId, { ...dto, weekday });
        }
        return this.listSchedule(userId);
    }
    listTasks(userId, dateStr) {
        this.ensureDefaultSchedule(userId);
        return this.read()
            .tasks.filter((t) => t.userId === userId && t.date === dateStr && !t.inBacklog)
            .sort((a, b) => a.order - b.order)
            .map((t) => this.toDto(t));
    }
    listBacklog(userId) {
        return this.read()
            .tasks.filter((t) => t.userId === userId &&
            t.inBacklog &&
            t.status !== 'completed')
            .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
            .map((t) => this.toDto(t));
    }
    carryOverUnfinished(userId, today) {
        const db = this.read();
        let count = 0;
        for (const t of db.tasks) {
            if (t.userId === userId &&
                !t.inBacklog &&
                !t.scheduleLocked &&
                t.status !== 'completed' &&
                t.date < today) {
                t.inBacklog = true;
                t.scheduledStart = null;
                t.scheduledEnd = null;
                count += 1;
            }
        }
        if (count)
            this.write(db);
        return count;
    }
    scheduleFromBacklog(userId, taskId, dateStr) {
        const db = this.read();
        const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
        if (!t)
            throw new Error('Task not found');
        const dayTasks = db.tasks.filter((x) => x.userId === userId && x.date === dateStr && !x.inBacklog);
        t.date = dateStr;
        t.inBacklog = false;
        t.scheduleLocked = false;
        t.scheduledStart = null;
        t.scheduledEnd = null;
        t.order =
            dayTasks.reduce((max, x) => Math.max(max, x.order), -1) + 1;
        this.write(db);
        this.rescheduleDay(userId, dateStr);
        return this.toDto(this.read().tasks.find((x) => x.id === taskId));
    }
    createTask(userId, dto) {
        this.ensureDefaultSchedule(userId);
        const db = this.read();
        const dayTasks = db.tasks.filter((t) => t.userId === userId && t.date === dto.date && !t.inBacklog);
        const order = dayTasks.reduce((max, t) => Math.max(max, t.order), -1) + 1;
        const scheduleLocked = Boolean(dto.scheduleLocked);
        const scheduledStart = dto.scheduledStart
            ? typeof dto.scheduledStart === 'string'
                ? dto.scheduledStart
                : dto.scheduledStart.toISOString()
            : null;
        const scheduledEnd = dto.scheduledEnd
            ? typeof dto.scheduledEnd === 'string'
                ? dto.scheduledEnd
                : dto.scheduledEnd.toISOString()
            : null;
        const task = {
            id: `ltask_${(0, crypto_1.randomBytes)(8).toString('hex')}`,
            userId,
            date: dto.date,
            name: dto.name.trim(),
            estimatedMinutes: dto.estimatedMinutes ?? 30,
            status: 'pending',
            order,
            scheduledStart,
            scheduledEnd,
            scheduleLocked,
            notes: null,
            inBacklog: false,
            actualMinutes: 0,
            activeEntryId: null,
        };
        db.tasks.push(task);
        this.write(db);
        this.rescheduleDay(userId, dto.date);
        return this.toDto(this.read().tasks.find((t) => t.id === task.id));
    }
    reorderTasks(userId, dateStr, taskIds) {
        const db = this.read();
        taskIds.forEach((id, index) => {
            const t = db.tasks.find((x) => x.id === id && x.userId === userId && x.date === dateStr);
            if (t)
                t.order = index;
        });
        this.write(db);
        this.rescheduleDay(userId, dateStr);
        return this.listTasks(userId, dateStr);
    }
    completeTask(userId, taskId) {
        const db = this.read();
        const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
        if (!t)
            throw new Error('Task not found');
        if (t.activeEntryId && t.timerStartedAt) {
            const started = new Date(t.timerStartedAt).getTime();
            const elapsed = Math.max(1, Math.round((Date.now() - started) / 60000));
            t.actualMinutes += elapsed;
            t.activeEntryId = null;
            t.timerStartedAt = null;
        }
        t.status = 'completed';
        this.write(db);
        this.rescheduleDay(userId, t.date);
        return this.toDto(this.read().tasks.find((x) => x.id === taskId));
    }
    updateTask(userId, taskId, patch, timeZone = 'UTC') {
        const db = this.read();
        const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
        if (!t)
            throw new Error('Task not found');
        const prevDate = t.date;
        if (patch.notes !== undefined)
            t.notes = patch.notes;
        if (patch.name !== undefined)
            t.name = patch.name.trim();
        if (patch.estimatedMinutes !== undefined) {
            t.estimatedMinutes = Math.round(patch.estimatedMinutes);
        }
        if (patch.order !== undefined)
            t.order = Math.max(0, Math.round(patch.order));
        if (patch.date !== undefined)
            t.date = patch.date;
        if (patch.inBacklog === true) {
            t.inBacklog = true;
            t.scheduledStart = null;
            t.scheduledEnd = null;
            t.scheduleLocked = false;
        }
        else if (patch.inBacklog === false) {
            t.inBacklog = false;
        }
        if (patch.unlockSchedule) {
            t.scheduleLocked = false;
            t.scheduledStart = null;
            t.scheduledEnd = null;
        }
        const startTime = patch.startTime === null ? null : patch.startTime?.trim() || undefined;
        const endTime = patch.endTime === null ? null : patch.endTime?.trim() || undefined;
        if (startTime || endTime) {
            if (!startTime || !endTime)
                throw new Error('Both start and end required');
            const startMin = (0, time_util_1.parseHm)(startTime);
            const endMin = (0, time_util_1.parseHm)(endTime);
            if (!(endMin > startMin))
                throw new Error('End must be after start');
            t.scheduledStart = (0, time_util_1.combineDateAndMinutes)(t.date, startMin, timeZone).toISOString();
            t.scheduledEnd = (0, time_util_1.combineDateAndMinutes)(t.date, endMin, timeZone).toISOString();
            t.scheduleLocked = true;
            t.estimatedMinutes = endMin - startMin;
            t.inBacklog = false;
        }
        this.write(db);
        if (!t.inBacklog)
            this.rescheduleDay(userId, t.date);
        if (prevDate !== t.date)
            this.rescheduleDay(userId, prevDate);
        return this.toDto(this.read().tasks.find((x) => x.id === taskId));
    }
    removeTask(userId, taskId) {
        const db = this.read();
        const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
        if (!t)
            throw new Error('Task not found');
        const date = t.date;
        db.tasks = db.tasks.filter((x) => x.id !== taskId);
        this.write(db);
        this.rescheduleDay(userId, date);
        return { ok: true };
    }
    startTimer(userId, taskId) {
        const db = this.read();
        const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
        if (!t)
            throw new Error('Task not found');
        if (t.status === 'completed')
            throw new Error('Task already completed');
        if (t.activeEntryId)
            throw new Error('Timer already running for this task');
        // Stop any other running timers for this user
        for (const other of db.tasks) {
            if (other.userId !== userId || other.id === taskId)
                continue;
            if (!other.activeEntryId || !other.timerStartedAt)
                continue;
            const started = new Date(other.timerStartedAt).getTime();
            const elapsed = Math.max(1, Math.round((Date.now() - started) / 60000));
            other.actualMinutes += elapsed;
            other.activeEntryId = null;
            other.timerStartedAt = null;
            if (other.status === 'in_progress')
                other.status = 'pending';
        }
        t.activeEntryId = `lentry_${(0, crypto_1.randomBytes)(6).toString('hex')}`;
        t.timerStartedAt = new Date().toISOString();
        if (t.status === 'pending')
            t.status = 'in_progress';
        this.write(db);
        return this.toDto(t);
    }
    stopTimer(userId, taskId) {
        const db = this.read();
        const t = db.tasks.find((x) => x.id === taskId && x.userId === userId);
        if (!t)
            throw new Error('Task not found');
        if (!t.activeEntryId || !t.timerStartedAt) {
            throw new Error('No active timer');
        }
        const started = new Date(t.timerStartedAt).getTime();
        const elapsed = Math.max(1, Math.round((Date.now() - started) / 60000));
        t.actualMinutes += elapsed;
        t.activeEntryId = null;
        t.timerStartedAt = null;
        if (t.status === 'in_progress')
            t.status = 'pending';
        this.write(db);
        return this.toDto(t);
    }
    overview(userId, dateStr) {
        this.ensureDefaultSchedule(userId);
        const day = (0, time_util_1.dateOnly)(dateStr);
        const weekStart = (0, time_util_1.startOfWeek)(day);
        const weekEnd = (0, time_util_1.addDays)(weekStart, 6);
        const weekStartStr = (0, time_util_1.formatDateOnly)(weekStart);
        const weekEndStr = (0, time_util_1.formatDateOnly)(weekEnd);
        const db = this.read();
        const todayTasks = db.tasks.filter((t) => t.userId === userId && t.date === dateStr);
        const weekTasks = db.tasks.filter((t) => t.userId === userId && t.date >= weekStartStr && t.date <= weekEndStr);
        const { availableMinutes } = this.getAvailable(userId, dateStr);
        const scheduledMinutes = todayTasks.reduce((s, t) => s + t.estimatedMinutes, 0);
        const utilizationPercent = availableMinutes === 0
            ? 0
            : Math.round((scheduledMinutes / availableMinutes) * 100);
        const counters = (tasks) => ({
            total: tasks.length,
            completed: tasks.filter((t) => t.status === 'completed').length,
            pending: tasks.filter((t) => t.status !== 'completed').length,
        });
        const recentStartStr = (0, time_util_1.formatDateOnly)((0, time_util_1.addDays)(day, -13));
        const recentTasks = db.tasks.filter((t) => t.userId === userId &&
            t.date >= recentStartStr &&
            t.date <= weekEndStr);
        return {
            today: counters(todayTasks),
            week: counters(weekTasks),
            utilization: {
                date: dateStr,
                availableMinutes,
                scheduledMinutes,
                utilizationPercent,
                tip: "Don't go over 80% utilization — leave room for ad-hoc tasks.",
            },
            effort: (0, effort_badges_1.buildEffortSummary)({
                date: dateStr,
                todayTasks,
                weekTasks,
                recentTasks,
                utilizationPercent,
            }),
        };
    }
    utilization(userId, dateStr) {
        return this.overview(userId, dateStr).utilization;
    }
    weeklyReport(userId, dateStr) {
        this.ensureDefaultSchedule(userId);
        const day = (0, time_util_1.dateOnly)(dateStr);
        const weekStart = (0, time_util_1.startOfWeek)(day);
        const weekEnd = (0, time_util_1.addDays)(weekStart, 6);
        const weekStartStr = (0, time_util_1.formatDateOnly)(weekStart);
        const weekEndStr = (0, time_util_1.formatDateOnly)(weekEnd);
        const db = this.read();
        const weekTasks = db.tasks.filter((t) => t.userId === userId && t.date >= weekStartStr && t.date <= weekEndStr);
        const byDay = [];
        for (let i = 0; i < 7; i++) {
            const d = (0, time_util_1.formatDateOnly)((0, time_util_1.addDays)(weekStart, i));
            const dayTasks = weekTasks.filter((t) => t.date === d);
            const completed = dayTasks.filter((t) => t.status === 'completed').length;
            const total = dayTasks.length;
            byDay.push({
                date: d,
                estimatedMinutes: dayTasks.reduce((s, t) => s + t.estimatedMinutes, 0),
                actualMinutes: dayTasks.reduce((s, t) => s + t.actualMinutes, 0),
                total,
                completed,
                pending: total - completed,
                completionPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
            });
        }
        const byTask = weekTasks.map((t) => ({
            taskId: t.id,
            name: t.name,
            date: t.date,
            estimatedMinutes: t.estimatedMinutes,
            actualMinutes: t.actualMinutes,
            status: t.status,
            varianceMinutes: t.actualMinutes - t.estimatedMinutes,
            scheduleLocked: Boolean(t.scheduleLocked),
            scheduledStart: t.scheduledStart ?? null,
            scheduledEnd: t.scheduledEnd ?? null,
        }));
        const total = weekTasks.length;
        const completed = weekTasks.filter((t) => t.status === 'completed').length;
        const totals = {
            estimatedMinutes: byDay.reduce((s, d) => s + d.estimatedMinutes, 0),
            actualMinutes: byDay.reduce((s, d) => s + d.actualMinutes, 0),
            total,
            completed,
            pending: total - completed,
            completionPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
        };
        return {
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            byDay,
            byTask,
            totals,
        };
    }
    eodSheet(userId, dateStr) {
        const db = this.read();
        const dayTasks = db.tasks.filter((t) => t.userId === userId && t.date === dateStr);
        const rows = dayTasks.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            estimatedMinutes: t.estimatedMinutes,
            actualMinutes: t.actualMinutes,
            varianceMinutes: t.actualMinutes - t.estimatedMinutes,
            scheduledStart: t.scheduledStart ?? null,
            scheduledEnd: t.scheduledEnd ?? null,
            scheduleLocked: Boolean(t.scheduleLocked),
            meetLink: t.meetLink ?? null,
            notes: t.notes ?? null,
        }));
        const total = rows.length;
        const completed = rows.filter((t) => t.status === 'completed').length;
        const inProgress = rows.filter((t) => t.status === 'in_progress').length;
        return {
            date: dateStr,
            generatedAt: new Date().toISOString(),
            summary: {
                total,
                completed,
                pending: total - completed,
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
    getAvailable(userId, dateStr) {
        const day = (0, time_util_1.dateOnly)(dateStr);
        const weekday = day.getUTCDay();
        const template = this.read().schedules.find((s) => s.userId === userId && s.weekday === weekday);
        if (!template)
            return { intervals: [], availableMinutes: 0 };
        let available = [
            {
                start: (0, time_util_1.parseHm)(template.workStart),
                end: (0, time_util_1.parseHm)(template.workEnd),
            },
        ];
        available = (0, time_util_1.subtractIntervals)(available, template.breaks.map((b) => ({
            start: (0, time_util_1.parseHm)(b.start),
            end: (0, time_util_1.parseHm)(b.end),
        })));
        const availableMinutes = available.reduce((sum, i) => sum + (i.end - i.start), 0);
        return { intervals: available, availableMinutes };
    }
    rescheduleUpcoming(userId) {
        const today = new Date();
        for (let i = 0; i < 7; i++) {
            this.rescheduleDay(userId, (0, time_util_1.formatDateOnly)((0, time_util_1.addDays)(today, i)));
        }
    }
    rescheduleDay(userId, dateStr) {
        const db = this.read();
        const day = (0, time_util_1.dateOnly)(dateStr);
        const { intervals } = this.getAvailable(userId, dateStr);
        const dayTasks = db.tasks
            .filter((t) => t.userId === userId && t.date === dateStr && !t.inBacklog)
            .sort((a, b) => a.order - b.order);
        const completed = dayTasks.filter((t) => t.status === 'completed');
        const locked = dayTasks.filter((t) => t.scheduleLocked && t.status !== 'completed');
        const pending = dayTasks.filter((t) => t.status !== 'completed' && !t.scheduleLocked);
        const busyFixed = [];
        for (const t of [...completed, ...locked]) {
            if (t.scheduledStart && t.scheduledEnd) {
                const s = new Date(t.scheduledStart);
                const e = new Date(t.scheduledEnd);
                busyFixed.push({
                    start: s.getUTCHours() * 60 + s.getUTCMinutes(),
                    end: e.getUTCHours() * 60 + e.getUTCMinutes(),
                });
            }
        }
        let free = (0, time_util_1.subtractIntervals)(intervals, busyFixed);
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
            if (placed) {
                task.scheduledStart = (0, time_util_1.combineDateAndMinutes)(day, placed.start).toISOString();
                task.scheduledEnd = (0, time_util_1.combineDateAndMinutes)(day, placed.end).toISOString();
            }
            else {
                task.inBacklog = true;
                task.scheduledStart = null;
                task.scheduledEnd = null;
                task.scheduleLocked = false;
            }
        }
        this.write(db);
    }
    toDto(t) {
        return {
            id: t.id,
            date: t.date,
            name: t.name,
            estimatedMinutes: t.estimatedMinutes,
            status: t.status,
            order: t.order,
            scheduledStart: t.scheduledStart,
            scheduledEnd: t.scheduledEnd,
            actualMinutes: t.actualMinutes,
            activeEntryId: t.activeEntryId,
            scheduleLocked: Boolean(t.scheduleLocked),
            meetLink: t.meetLink ?? null,
            sourceProvider: t.sourceProvider ?? null,
            notes: t.notes ?? null,
            inBacklog: Boolean(t.inBacklog),
        };
    }
};
exports.LocalDataStore = LocalDataStore;
exports.LocalDataStore = LocalDataStore = __decorate([
    (0, common_1.Injectable)()
], LocalDataStore);
//# sourceMappingURL=local-data.store.js.map