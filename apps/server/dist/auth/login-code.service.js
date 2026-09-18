"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginCodeService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
/**
 * Short-lived login codes for Google OAuth handoff (:3001 → Vite :5173).
 * Codes are reusable until expiry so React StrictMode double-mount
 * (or a page refresh mid-exchange) does not burn the only use.
 */
let LoginCodeService = class LoginCodeService {
    codes = new Map();
    issue(userId, ttlMs = 120_000) {
        this.sweep();
        const code = (0, crypto_1.randomBytes)(24).toString('base64url');
        this.codes.set(code, { userId, expiresAt: Date.now() + ttlMs });
        return code;
    }
    /** Resolve userId without invalidating — safe for concurrent/retry calls. */
    resolve(code) {
        this.sweep();
        const entry = this.codes.get(code);
        if (!entry)
            return null;
        if (entry.expiresAt < Date.now()) {
            this.codes.delete(code);
            return null;
        }
        return entry.userId;
    }
    /** @deprecated use resolve — kept for any older callers */
    consume(code) {
        return this.resolve(code);
    }
    invalidate(code) {
        this.codes.delete(code);
    }
    sweep() {
        const now = Date.now();
        for (const [k, v] of this.codes) {
            if (v.expiresAt < now)
                this.codes.delete(k);
        }
    }
};
exports.LoginCodeService = LoginCodeService;
exports.LoginCodeService = LoginCodeService = __decorate([
    (0, common_1.Injectable)()
], LoginCodeService);
//# sourceMappingURL=login-code.service.js.map