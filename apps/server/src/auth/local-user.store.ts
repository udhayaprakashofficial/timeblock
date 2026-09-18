import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export type LocalUser = {
  id: string;
  email: string;
  name: string;
  theme: 'light' | 'dark';
  googleId?: string;
  accessToken?: string;
  refreshToken?: string;
  passwordHash?: string;
  connectedProviders: Array<'google' | 'microsoft'>;
};

type StoreFile = {
  users: LocalUser[];
};

/**
 * File-backed user store used when Supabase/Postgres is unreachable.
 */
@Injectable()
export class LocalUserStore {
  private readonly dir = resolve(__dirname, '../../data');
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
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
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
        theme: 'light',
        googleId: input.googleId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
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
        theme: 'light',
        passwordHash: input.passwordHash,
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
