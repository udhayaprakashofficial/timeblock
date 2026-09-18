"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSessionStore = void 0;
const session = require("express-session");
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * File-backed session store used when Postgres is unreachable.
 * Survives Nest restarts (unlike MemoryStore).
 */
class FileSessionStore extends session.Store {
    dir = (0, path_1.resolve)(__dirname, '../../data');
    file = (0, path_1.resolve)(this.dir, 'sessions.json');
    read() {
        if (!(0, fs_1.existsSync)(this.file))
            return { sessions: {} };
        try {
            return JSON.parse((0, fs_1.readFileSync)(this.file, 'utf8'));
        }
        catch {
            return { sessions: {} };
        }
    }
    write(data) {
        if (!(0, fs_1.existsSync)(this.dir))
            (0, fs_1.mkdirSync)(this.dir, { recursive: true });
        (0, fs_1.writeFileSync)(this.file, JSON.stringify(data), 'utf8');
    }
    get(sid, callback) {
        try {
            const db = this.read();
            const row = db.sessions[sid];
            if (!row)
                return callback(null, null);
            if (row.expiresAt < Date.now()) {
                delete db.sessions[sid];
                this.write(db);
                return callback(null, null);
            }
            return callback(null, row.data);
        }
        catch (err) {
            return callback(err);
        }
    }
    set(sid, sessionData, callback) {
        try {
            const maxAge = typeof sessionData.cookie?.maxAge === 'number'
                ? sessionData.cookie.maxAge
                : 7 * 24 * 60 * 60 * 1000;
            const db = this.read();
            db.sessions[sid] = {
                data: sessionData,
                expiresAt: Date.now() + maxAge,
            };
            this.write(db);
            callback?.();
        }
        catch (err) {
            callback?.(err);
        }
    }
    destroy(sid, callback) {
        try {
            const db = this.read();
            delete db.sessions[sid];
            this.write(db);
            callback?.();
        }
        catch (err) {
            callback?.(err);
        }
    }
    touch(sid, sessionData, callback) {
        this.set(sid, sessionData, callback);
    }
}
exports.FileSessionStore = FileSessionStore;
//# sourceMappingURL=file-session.store.js.map