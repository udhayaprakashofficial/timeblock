"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalUserStore = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * File-backed user store used when Supabase/Postgres is unreachable.
 */
let LocalUserStore = class LocalUserStore {
    dir = (0, path_1.resolve)(__dirname, '../../data');
    file = (0, path_1.resolve)(this.dir, 'local-users.json');
    read() {
        if (!(0, fs_1.existsSync)(this.file))
            return { users: [] };
        try {
            return JSON.parse((0, fs_1.readFileSync)(this.file, 'utf8'));
        }
        catch {
            return { users: [] };
        }
    }
    write(data) {
        if (!(0, fs_1.existsSync)(this.dir))
            (0, fs_1.mkdirSync)(this.dir, { recursive: true });
        (0, fs_1.writeFileSync)(this.file, JSON.stringify(data, null, 2), 'utf8');
    }
    upsertGoogle(input) {
        const db = this.read();
        const email = input.email.trim().toLowerCase();
        let user = db.users.find((u) => u.googleId === input.googleId) ||
            db.users.find((u) => u.email === email);
        if (!user) {
            user = {
                id: `local_${(0, crypto_1.randomBytes)(8).toString('hex')}`,
                email,
                name: input.name,
                theme: 'light',
                googleId: input.googleId,
                accessToken: input.accessToken,
                refreshToken: input.refreshToken,
                connectedProviders: ['google'],
            };
            db.users.push(user);
        }
        else {
            user.name = input.name || user.name;
            user.email = email;
            user.googleId = input.googleId;
            user.accessToken = input.accessToken;
            if (input.refreshToken)
                user.refreshToken = input.refreshToken;
            if (!user.connectedProviders.includes('google')) {
                user.connectedProviders.push('google');
            }
        }
        this.write(db);
        return user;
    }
    save(user) {
        const db = this.read();
        const idx = db.users.findIndex((u) => u.id === user.id);
        if (idx >= 0)
            db.users[idx] = user;
        else
            db.users.push(user);
        this.write(db);
        return user;
    }
    findById(id) {
        return this.read().users.find((u) => u.id === id) ?? null;
    }
    findByEmail(email) {
        const e = email.trim().toLowerCase();
        return this.read().users.find((u) => u.email === e) ?? null;
    }
    upsertPassword(input) {
        const db = this.read();
        const email = input.email.trim().toLowerCase();
        let user = db.users.find((u) => u.email === email);
        if (!user) {
            user = {
                id: `local_${(0, crypto_1.randomBytes)(8).toString('hex')}`,
                email,
                name: input.name,
                theme: 'light',
                passwordHash: input.passwordHash,
                connectedProviders: [],
            };
            db.users.push(user);
        }
        else {
            user.name = input.name || user.name;
            user.passwordHash = input.passwordHash;
        }
        this.write(db);
        return user;
    }
};
exports.LocalUserStore = LocalUserStore;
exports.LocalUserStore = LocalUserStore = __decorate([
    (0, common_1.Injectable)()
], LocalUserStore);
//# sourceMappingURL=local-user.store.js.map