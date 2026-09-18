"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaSessionStore = void 0;
const session = require("express-session");
/**
 * Persists express-session in the app DB (tied to User when logged in).
 */
class PrismaSessionStore extends session.Store {
    prisma;
    constructor(prisma) {
        super();
        this.prisma = prisma;
    }
    get(sid, callback) {
        this.prisma.session
            .findUnique({ where: { sid } })
            .then((row) => {
            if (!row)
                return callback(null, null);
            if (row.expiresAt.getTime() < Date.now()) {
                return this.destroy(sid, () => callback(null, null));
            }
            callback(null, JSON.parse(row.data));
        })
            .catch((err) => callback(err));
    }
    set(sid, sessionData, callback) {
        const maxAge = typeof sessionData.cookie?.maxAge === 'number'
            ? sessionData.cookie.maxAge
            : 7 * 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + maxAge);
        const userId = typeof sessionData.userId === 'string' ? sessionData.userId : null;
        const data = JSON.stringify(sessionData);
        this.prisma.session
            .upsert({
            where: { sid },
            create: { sid, data, expiresAt, userId },
            update: { data, expiresAt, userId },
        })
            .then(() => callback?.())
            .catch((err) => callback?.(err));
    }
    destroy(sid, callback) {
        this.prisma.session
            .deleteMany({ where: { sid } })
            .then(() => callback?.())
            .catch((err) => callback?.(err));
    }
    touch(sid, sessionData, callback) {
        const maxAge = typeof sessionData.cookie?.maxAge === 'number'
            ? sessionData.cookie.maxAge
            : 7 * 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + maxAge);
        this.prisma.session
            .updateMany({ where: { sid }, data: { expiresAt } })
            .then(() => callback?.())
            .catch((err) => callback?.(err));
    }
}
exports.PrismaSessionStore = PrismaSessionStore;
//# sourceMappingURL=prisma-session.store.js.map