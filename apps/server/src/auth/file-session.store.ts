import session = require('express-session');
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

type Callback = (err?: unknown, sessionData?: session.SessionData | null) => void;

type Stored = {
  sessions: Record<
    string,
    { data: session.SessionData; expiresAt: number }
  >;
};

/**
 * File-backed session store used when Postgres is unreachable.
 * Survives Nest restarts (unlike MemoryStore).
 */
export class FileSessionStore extends session.Store {
  private readonly dir = resolve(__dirname, '../../data');
  private readonly file = resolve(this.dir, 'sessions.json');

  private read(): Stored {
    if (!existsSync(this.file)) return { sessions: {} };
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Stored;
    } catch {
      return { sessions: {} };
    }
  }

  private write(data: Stored) {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(data), 'utf8');
  }

  get(sid: string, callback: Callback): void {
    try {
      const db = this.read();
      const row = db.sessions[sid];
      if (!row) return callback(null, null);
      if (row.expiresAt < Date.now()) {
        delete db.sessions[sid];
        this.write(db);
        return callback(null, null);
      }
      return callback(null, row.data);
    } catch (err) {
      return callback(err);
    }
  }

  set(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    try {
      const maxAge =
        typeof sessionData.cookie?.maxAge === 'number'
          ? sessionData.cookie.maxAge
          : 7 * 24 * 60 * 60 * 1000;
      const db = this.read();
      db.sessions[sid] = {
        data: sessionData,
        expiresAt: Date.now() + maxAge,
      };
      this.write(db);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      const db = this.read();
      delete db.sessions[sid];
      this.write(db);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    this.set(sid, sessionData, callback);
  }
}
