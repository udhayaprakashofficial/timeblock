"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleTemplatesModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_service_1 = require("./schedule.service");
const schedule_controller_1 = require("./schedule.controller");
const tasks_module_1 = require("../tasks/tasks.module");
const auth_module_1 = require("../auth/auth.module");
let ScheduleTemplatesModule = class ScheduleTemplatesModule {
};
exports.ScheduleTemplatesModule = ScheduleTemplatesModule;
exports.ScheduleTemplatesModule = ScheduleTemplatesModule = __decorate([
    (0, common_1.Module)({
        imports: [tasks_module_1.TasksModule, (0, common_1.forwardRef)(() => auth_module_1.AuthModule)],
        providers: [schedule_service_1.ScheduleTemplatesService],
        controllers: [schedule_controller_1.ScheduleTemplatesController],
        exports: [schedule_service_1.ScheduleTemplatesService],
    })
], ScheduleTemplatesModule);
//# sourceMappingURL=schedule.module.js.map