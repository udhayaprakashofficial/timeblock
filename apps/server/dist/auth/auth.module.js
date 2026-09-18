"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const auth_service_1 = require("./auth.service");
const auth_controller_1 = require("./auth.controller");
const google_oauth_registrar_1 = require("./google-oauth.registrar");
const clerk_auth_service_1 = require("./clerk-auth.service");
const microsoft_strategy_1 = require("./microsoft.strategy");
const login_code_service_1 = require("./login-code.service");
const local_user_store_1 = require("./local-user.store");
const local_data_store_1 = require("./local-data.store");
const users_module_1 = require("../users/users.module");
const calendar_module_1 = require("../calendar/calendar.module");
const oauthProviders = [];
if (process.env.MICROSOFT_CLIENT_ID?.trim() &&
    process.env.MICROSOFT_CLIENT_ID !== 'missing') {
    oauthProviders.push(microsoft_strategy_1.MicrosoftStrategy);
}
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            passport_1.PassportModule.register({ session: false }),
            (0, common_1.forwardRef)(() => users_module_1.UsersModule),
            (0, common_1.forwardRef)(() => calendar_module_1.CalendarModule),
        ],
        providers: [
            auth_service_1.AuthService,
            google_oauth_registrar_1.GoogleOAuthRegistrar,
            clerk_auth_service_1.ClerkAuthService,
            login_code_service_1.LoginCodeService,
            local_user_store_1.LocalUserStore,
            local_data_store_1.LocalDataStore,
            ...oauthProviders,
        ],
        controllers: [auth_controller_1.AuthController],
        exports: [
            auth_service_1.AuthService,
            google_oauth_registrar_1.GoogleOAuthRegistrar,
            clerk_auth_service_1.ClerkAuthService,
            local_user_store_1.LocalUserStore,
            local_data_store_1.LocalDataStore,
        ],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map