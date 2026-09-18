"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createId = createId;
const crypto_1 = require("crypto");
/** Compact unique id (cuid-like) for rows inserted via Supabase REST. */
function createId(prefix = 'c') {
    return `${prefix}${Date.now().toString(36)}${(0, crypto_1.randomBytes)(6).toString('hex')}`;
}
//# sourceMappingURL=create-id.js.map