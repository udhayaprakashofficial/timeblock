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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("./users.service");
let UsersController = class UsersController {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    authConfig() {
        return this.usersService.authConfig();
    }
    /** Soft auth check — returns JSON `null` (200) when logged out instead of 401. */
    async me(req, res) {
        const userId = req.session?.userId;
        if (!userId) {
            return res.status(200).json(null);
        }
        const me = await this.usersService.getMe(userId);
        return res.status(200).json(me);
    }
    async updateMe(req, res, body) {
        const userId = req.session?.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Not authenticated' });
        }
        const me = await this.usersService.updateProfile(userId, body);
        return res.json(me);
    }
    async devLogin(req, res) {
        const config = this.usersService.authConfig();
        if (!config.allowDevLogin) {
            return res.status(403).json({
                error: 'Dev login is disabled in this environment',
            });
        }
        try {
            const user = await this.usersService.ensureDevUser();
            req.session.userId = user.id;
            req.session.save((err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to save session' });
                }
                return this.usersService
                    .getMe(user.id)
                    .then((me) => res.json(me))
                    .catch((e) => res.status(500).json({ error: String(e) }));
            });
        }
        catch (e) {
            return res.status(400).json({
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)('auth-config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "authConfig", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "me", null);
__decorate([
    (0, common_1.Patch)('me'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "updateMe", null);
__decorate([
    (0, common_1.Post)('dev-login'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "devLogin", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], UsersController);
//# sourceMappingURL=users.controller.js.map