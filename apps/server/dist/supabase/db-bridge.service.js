"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DbBridgeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbBridgeService = void 0;
const common_1 = require("@nestjs/common");
const local_user_store_1 = require("../auth/local-user.store");
const local_data_store_1 = require("../auth/local-data.store");
const crypto_service_1 = require("../crypto/crypto.service");
const supabase_rest_service_1 = require("./supabase-rest.service");
const create_id_1 = require("./create-id");
/**
 * Routes app data to Supabase DB when keys are configured.
 * Maps offline `local_*` session users onto real User rows and migrates JSON data.
 */
let DbBridgeService = DbBridgeService_1 = class DbBridgeService {
    supabase;
    localUsers;
    localData;
    crypto;
    logger = new common_1.Logger(DbBridgeService_1.name);
    mapped = new Map();
    migrated = new Set();
    constructor(supabase, localUsers, localData, crypto) {
        this.supabase = supabase;
        this.localUsers = localUsers;
        this.localData = localData;
        this.crypto = crypto;
    }
    /** True when APIs must use the database (HTTPS REST). */
    useDb() {
        return this.supabase.isConfigured();
    }
    /**
     * Resolve session userId to a Supabase User.id.
     * Migrates local file users + their tasks/schedules into the DB once.
     */
    async resolveUserId(userId) {
        if (!userId.startsWith('local_'))
            return userId;
        const cached = this.mapped.get(userId);
        if (cached)
            return cached;
        if (!this.useDb())
            return userId;
        const local = this.localUsers.findById(userId);
        if (!local?.email) {
            throw new Error(`Unknown local user ${userId}`);
        }
        await this.supabase.ping();
        const dbUser = await this.supabase.upsertGoogleUser({
            email: local.email,
            name: local.name,
            googleId: local.googleId || `local-${local.id}`,
            accessTokenEncrypted: this.crypto.encrypt(local.accessToken || 'local-placeholder-token'),
            refreshTokenEncrypted: local.refreshToken
                ? this.crypto.encrypt(local.refreshToken)
                : null,
        });
        this.mapped.set(userId, dbUser.id);
        await this.migrateLocalData(userId, dbUser.id);
        this.logger.log(`Mapped ${userId} → DB user ${dbUser.id} (${local.email})`);
        return dbUser.id;
    }
    async migrateLocalData(localUserId, dbUserId) {
        if (this.migrated.has(localUserId))
            return;
        this.migrated.add(localUserId);
        try {
            const schedules = this.localData.listSchedule(localUserId);
            const existing = await this.supabase.listSchedule(dbUserId);
            if (!existing.length && schedules.length) {
                for (const s of schedules) {
                    await this.supabase.upsertSchedule(dbUserId, {
                        weekday: s.weekday,
                        workStart: s.workStart,
                        workEnd: s.workEnd,
                        breaks: s.breaks.map((b) => ({
                            name: b.name,
                            start: b.start,
                            end: b.end,
                        })),
                    });
                }
                this.logger.log(`Migrated ${schedules.length} schedule rows → DB`);
            }
            // Pull tasks from the local JSON file for this user
            const { readFileSync, existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
            const { resolve } = await Promise.resolve().then(() => __importStar(require('path')));
            const file = resolve(__dirname, '../../data/local-app.json');
            if (!existsSync(file))
                return;
            const raw = JSON.parse(readFileSync(file, 'utf8'));
            const tasks = (raw.tasks ?? []).filter((t) => t.userId === localUserId);
            if (!tasks.length)
                return;
            let copied = 0;
            for (const t of tasks) {
                const found = await this.supabase.select('Task', 'id', {
                    filter: `userId=eq.${dbUserId}&date=eq.${t.date}&name=eq.${encodeURIComponent(t.name)}`,
                    limit: 1,
                });
                if (found.length)
                    continue;
                const now = new Date().toISOString();
                await this.supabase.insert('Task', {
                    id: (0, create_id_1.createId)(),
                    userId: dbUserId,
                    date: t.date,
                    name: t.name,
                    estimatedMinutes: t.estimatedMinutes,
                    status: t.status,
                    order: t.order,
                    scheduledStart: t.scheduledStart,
                    scheduledEnd: t.scheduledEnd,
                    createdAt: now,
                    updatedAt: now,
                });
                copied += 1;
            }
            if (copied)
                this.logger.log(`Migrated ${copied} tasks → DB`);
        }
        catch (err) {
            this.logger.warn(`Local→DB migrate partial: ${err instanceof Error ? err.message : err}`);
        }
    }
};
exports.DbBridgeService = DbBridgeService;
exports.DbBridgeService = DbBridgeService = DbBridgeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_rest_service_1.SupabaseRestService,
        local_user_store_1.LocalUserStore,
        local_data_store_1.LocalDataStore,
        crypto_service_1.CryptoService])
], DbBridgeService);
//# sourceMappingURL=db-bridge.service.js.map