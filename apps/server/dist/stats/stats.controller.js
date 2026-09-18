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
exports.StatsController = void 0;
const common_1 = require("@nestjs/common");
const session_guard_1 = require("../auth/session.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const stats_service_1 = require("./stats.service");
let StatsController = class StatsController {
    statsService;
    constructor(statsService) {
        this.statsService = statsService;
    }
    overview(userId, date) {
        return this.statsService.overview(userId, date);
    }
    weekly(userId, date) {
        return this.statsService.weeklyReport(userId, date);
    }
    eod(userId, date) {
        return this.statsService.eodSheet(userId, date);
    }
};
exports.StatsController = StatsController;
__decorate([
    (0, common_1.Get)('overview'),
    __param(0, (0, current_user_decorator_1.CurrentUserId)()),
    __param(1, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], StatsController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('weekly'),
    __param(0, (0, current_user_decorator_1.CurrentUserId)()),
    __param(1, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], StatsController.prototype, "weekly", null);
__decorate([
    (0, common_1.Get)('eod'),
    __param(0, (0, current_user_decorator_1.CurrentUserId)()),
    __param(1, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], StatsController.prototype, "eod", null);
exports.StatsController = StatsController = __decorate([
    (0, common_1.Controller)('stats'),
    (0, common_1.UseGuards)(session_guard_1.SessionAuthGuard),
    __metadata("design:paramtypes", [stats_service_1.StatsService])
], StatsController);
//# sourceMappingURL=stats.controller.js.map