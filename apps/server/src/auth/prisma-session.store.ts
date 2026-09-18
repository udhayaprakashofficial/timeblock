import session = require('express-session');
import { PrismaClient } from '@prisma/client';

type Callback = (err?: unknown, session?: session.SessionData | null) => void;

/**
 * Persists express-session in the app DB (tied to User when logged in).
 */
export class PrismaSessionStore extends session.Store {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  get(sid: string, callback: Callback): void {
    this.prisma.session
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row) return callback(null, null);
        if (row.expiresAt.getTime() < Date.now()) {
          return this.destroy(sid, () => callback(null, null));
        }
        callback(null, JSON.parse(row.data) as session.SessionData);
      })
      .catch((err) => callback(err));
  }

  set(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    const maxAge =
      typeof sessionData.cookie?.maxAge === 'number'
        ? sessionData.cookie.maxAge
        : 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + maxAge);
    const userId =
      typeof sessionData.userId === 'string' ? sessionData.userId : null;
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

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.prisma.session
      .deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  touch(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    const maxAge =
      typeof sessionData.cookie?.maxAge === 'number'
        ? sessionData.cookie.maxAge
        : 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + maxAge);
    this.prisma.session
      .updateMany({ where: { sid }, data: { expiresAt } })
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }
}
