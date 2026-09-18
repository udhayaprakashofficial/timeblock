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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleTemplatesController = void 0;
const common_1 = require("@nestjs/common");
const session_guard_1 = require("../auth/session.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const schedule_service_1 = require("./schedule.service");
let ScheduleTemplatesController = class ScheduleTemplatesController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(userId) {
        return this.service.list(userId);
    }
    upsert(userId, body) {
        return this.service.upsert(userId, body);
    }
    applyAll(userId, body) {
        return this.service.applyToAllDays(userId, body);
    }
};
exports.ScheduleTemplatesController = ScheduleTemplatesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUserId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ScheduleTemplatesController.prototype, "list", null);
__decorate([
    (0, common_1.Put)(),
    __param(0, (0, current_user_decorator_1.CurrentUserId)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ScheduleTemplatesController.prototype, "upsert", null);
__decorate([
    (0, common_1.Put)('apply-all'),
    __param(0, (0, current_user_decorator_1.CurrentUserId)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ScheduleTemplatesController.prototype, "applyAll", null);
exports.ScheduleTemplatesController = ScheduleTemplatesController = __decorate([
    (0, common_1.Controller)('schedule'),
    (0, common_1.UseGuards)(session_guard_1.SessionAuthGuard),
    __metadata("design:paramtypes", [schedule_service_1.ScheduleTemplatesService])
], ScheduleTemplatesController);
//# sourceMappingURL=schedule.controller.js.map