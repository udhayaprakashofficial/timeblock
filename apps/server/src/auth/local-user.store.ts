import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

export type LocalUser = {
  id: string;
  email: string;
  name: string;
  theme: 'light' | 'dark';
  timezone?: string;
  googleId?: string;
  accessToken?: string;
  refreshToken?: string;
  passwordHash?: string;
  onboardingCompleted?: boolean;
  connectedProviders: Array<'google' | 'microsoft'>;
};

type StoreFile = {
  users: LocalUser[];
  /** Overlay for any user id when DB column is missing / unreachable */
  onboardingCompletedByUserId?: Record<string, boolean>;
};

function localDataDir() {
  // Vercel / Lambda FS is read-only except /tmp
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return resolve(tmpdir(), 'cupkey-data');
  }
  return resolve(__dirname, '../../data');
}

/**
 * File-backed user store used when Supabase/Postgres is unreachable.
 */
@Injectable()
export class LocalUserStore {
  private readonly dir = localDataDir();
  private readonly file = resolve(this.dir, 'local-users.json');

  private read(): StoreFile {
    if (!existsSync(this.file)) return { users: [] };
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
    } catch {
      return { users: [] };
    }
  }

  private write(data: StoreFile) {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn(
        '[local-users] write skipped',
        err instanceof Error ? err.message : err,
      );
    }
  }

  upsertGoogle(input: {
    email: string;
    name: string;
    googleId: string;
    accessToken: string;
    refreshToken?: string;
  }): LocalUser {
    const db = this.read();
    const email = input.email.trim().toLowerCase();
    let user =
      db.users.find((u) => u.googleId === input.googleId) ||
      db.users.find((u) => u.email === email);

    if (!user) {
      user = {
        id: `local_${randomBytes(8).toString('hex')}`,
        email,
        name: input.name,
        theme: 'dark',
        googleId: input.googleId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        onboardingCompleted: false,
        connectedProviders: ['google'],
      };
      db.users.push(user);
    } else {
      user.name = input.name || user.name;
      user.email = email;
      user.googleId = input.googleId;
      user.accessToken = input.accessToken;
      if (input.refreshToken) user.refreshToken = input.refreshToken;
      if (!user.connectedProviders.includes('google')) {
        user.connectedProviders.push('google');
      }
    }

    this.write(db);
    return user;
  }

  save(user: LocalUser): LocalUser {
    const db = this.read();
    const idx = db.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) db.users[idx] = user;
    else db.users.push(user);
    this.write(db);
    return user;
  }

  findById(id: string): LocalUser | null {
    return this.read().users.find((u) => u.id === id) ?? null;
  }

  findByEmail(email: string): LocalUser | null {
    const e = email.trim().toLowerCase();
    return this.read().users.find((u) => u.email === e) ?? null;
  }

  /** Persist onboarding flag even when Supabase User column is missing. */
  setOnboardingCompleted(userId: string, value: boolean) {
    const db = this.read();
    const map = { ...(db.onboardingCompletedByUserId ?? {}) };
    map[userId] = value;
    db.onboardingCompletedByUserId = map;
    this.write(db);
  }

  getOnboardingCompleted(userId: string): boolean | undefined {
    const v = this.read().onboardingCompletedByUserId?.[userId];
    return typeof v === 'boolean' ? v : undefined;
  }

  upsertPassword(input: {
    email: string;
    name: string;
    passwordHash: string;
  }): LocalUser {
    const db = this.read();
    const email = input.email.trim().toLowerCase();
    let user = db.users.find((u) => u.email === email);
    if (!user) {
      user = {
        id: `local_${randomBytes(8).toString('hex')}`,
        email,
        name: input.name,
        theme: 'dark',
        passwordHash: input.passwordHash,
        onboardingCompleted: false,
        connectedProviders: [],
      };
      db.users.push(user);
    } else {
      user.name = input.name || user.name;
      user.passwordHash = input.passwordHash;
    }
    this.write(db);
    return user;
  }
}
