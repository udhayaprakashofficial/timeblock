"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseModule = void 0;
const common_1 = require("@nestjs/common");
const supabase_rest_service_1 = require("./supabase-rest.service");
const db_bridge_service_1 = require("./db-bridge.service");
const local_user_store_1 = require("../auth/local-user.store");
const local_data_store_1 = require("../auth/local-data.store");
let SupabaseModule = class SupabaseModule {
};
exports.SupabaseModule = SupabaseModule;
exports.SupabaseModule = SupabaseModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            supabase_rest_service_1.SupabaseRestService,
            db_bridge_service_1.DbBridgeService,
            // Same file-backed stores as AuthModule (shared JSON paths)
            local_user_store_1.LocalUserStore,
            local_data_store_1.LocalDataStore,
        ],
        exports: [supabase_rest_service_1.SupabaseRestService, db_bridge_service_1.DbBridgeService],
    })
], SupabaseModule);
//# sourceMappingURL=supabase.module.js.map