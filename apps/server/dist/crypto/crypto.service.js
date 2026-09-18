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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
let CryptoService = class CryptoService {
    key;
    constructor() {
        const secret = process.env.TOKEN_ENCRYPTION_KEY ?? 'dev-encryption-key-change-me';
        this.key = (0, crypto_1.scryptSync)(secret, 'timeblock-salt', 32);
    }
    encrypt(plaintext) {
        const iv = (0, crypto_1.randomBytes)(12);
        const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', this.key, iv);
        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]).toString('base64');
    }
    decrypt(payload) {
        const buf = Buffer.from(payload, 'base64');
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const data = buf.subarray(28);
        const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', this.key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
        return decrypted.toString('utf8');
    }
    /** Format: scrypt$<saltB64>$<hashB64> */
    hashPassword(password) {
        const salt = (0, crypto_1.randomBytes)(16);
        const hash = (0, crypto_1.scryptSync)(password, salt, 64);
        return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
    }
    verifyPassword(password, stored) {
        const parts = stored.split('$');
        if (parts.length !== 3 || parts[0] !== 'scrypt')
            return false;
        const salt = Buffer.from(parts[1], 'base64');
        const expected = Buffer.from(parts[2], 'base64');
        const actual = (0, crypto_1.scryptSync)(password, salt, expected.length);
        if (actual.length !== expected.length)
            return false;
        return (0, crypto_1.timingSafeEqual)(actual, expected);
    }
};
exports.CryptoService = CryptoService;
exports.CryptoService = CryptoService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], CryptoService);
//# sourceMappingURL=crypto.service.js.map