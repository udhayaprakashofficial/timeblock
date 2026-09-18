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
exports.TimerController = void 0;
const common_1 = require("@nestjs/common");
const session_guard_1 = require("../auth/session.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const timer_service_1 = require("./timer.service");
let TimerController = class TimerController {
    timerService;
    constructor(timerService) {
        this.timerService = timerService;
    }
    start(userId, taskId) {
        return this.timerService.start(userId, taskId);
    }
    stop(userId, taskId) {
        return this.timerService.stop(userId, taskId);
    }
};
exports.TimerController = TimerController;
__decorate([
    (0, common_1.Post)(':taskId/start'),
    __param(0, (0, current_user_decorator_1.CurrentUserId)()),
    __param(1, (0, common_1.Param)('taskId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TimerController.prototype, "start", null);
__decorate([
    (0, common_1.Post)(':taskId/stop'),
    __param(0, (0, current_user_decorator_1.CurrentUserId)()),
    __param(1, (0, common_1.Param)('taskId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TimerController.prototype, "stop", null);
exports.TimerController = TimerController = __decorate([
    (0, common_1.Controller)('timer'),
    (0, common_1.UseGuards)(session_guard_1.SessionAuthGuard),
    __metadata("design:paramtypes", [timer_service_1.TimerService])
], TimerController);
//# sourceMappingURL=timer.controller.js.map