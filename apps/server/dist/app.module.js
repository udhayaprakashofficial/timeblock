"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const prisma_module_1 = require("./prisma/prisma.module");
const crypto_module_1 = require("./crypto/crypto.module");
const supabase_module_1 = require("./supabase/supabase.module");
const auth_module_1 = require("./auth/auth.module");
const schedule_module_1 = require("./schedule/schedule.module");
const tasks_module_1 = require("./tasks/tasks.module");
const timer_module_1 = require("./timer/timer.module");
const stats_module_1 = require("./stats/stats.module");
const calendar_module_1 = require("./calendar/calendar.module");
const users_module_1 = require("./users/users.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: ['.env', '../../.env'],
            }),
            schedule_1.ScheduleModule.forRoot(),
            prisma_module_1.PrismaModule,
            crypto_module_1.CryptoModule,
            supabase_module_1.SupabaseModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            schedule_module_1.ScheduleTemplatesModule,
            tasks_module_1.TasksModule,
            timer_module_1.TimerModule,
            stats_module_1.StatsModule,
            calendar_module_1.CalendarModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map