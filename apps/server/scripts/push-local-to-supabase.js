#!/usr/bin/env node
/**
 * Push local-users.json into Supabase via PostgREST (HTTPS).
 * Uses SUPABASE_URL + SUPABASE_SECRET_KEY from apps/server/.env
 *
 *   node scripts/push-local-to-supabase.js
 */
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');
const {
  createCipheriv,
  randomBytes,
  scryptSync,
} = require('crypto');
const { config } = require('dotenv');

config({ path: resolve(__dirname, '../.env') });

const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey =
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
  '';

function createId(prefix = 'c') {
  return `${prefix}${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

function encrypt(plaintext) {
  const secret =
    process.env.TOKEN_ENCRYPTION_KEY ?? 'dev-encryption-key-change-me';
  const key = scryptSync(secret, 'timeblock-salt', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!text) return [];
  return JSON.parse(text);
}

async function main() {
  if (!baseUrl || !apiKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in apps/server/.env');
    process.exit(1);
  }

  // Smoke test
  await rest('User?select=id&limit=1');
  console.log('Supabase REST reachable.');

  const file = resolve(__dirname, '../data/local-users.json');
  if (!existsSync(file)) {
    console.error('No local-users.json — nothing to push.');
    process.exit(1);
  }
  const { users } = JSON.parse(readFileSync(file, 'utf8'));
  if (!users?.length) {
    console.error('local-users.json is empty.');
    process.exit(1);
  }

  for (const u of users) {
    const email = String(u.email).toLowerCase();
    const name = u.name || email;
    let rows = await rest(
      `User?select=id,name,email,theme&email=eq.${encodeURIComponent(email)}&limit=1`,
    );
    let user = rows[0];
    const now = new Date().toISOString();
    if (!user) {
      const id = createId();
      rows = await rest('User', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id,
          name,
          email,
          theme: u.theme || 'light',
          createdAt: now,
          updatedAt: now,
        },
      });
      user = rows[0];
      console.log('Created User', user.id, email);
    } else {
      rows = await rest(`User?id=eq.${user.id}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { name, updatedAt: now },
      });
      user = rows[0] || user;
      console.log('Updated User', user.id, email);
    }

    if (u.googleId && u.accessToken) {
      const oauth = await rest(
        `OAuthAccount?select=id&userId=eq.${user.id}&provider=eq.google&limit=1`,
      );
      const tokenPayload = {
        providerAccountId: String(u.googleId),
        accessTokenEncrypted: encrypt(u.accessToken),
        refreshTokenEncrypted: u.refreshToken ? encrypt(u.refreshToken) : null,
        scope: 'calendar.readonly email profile',
        updatedAt: now,
      };
      if (oauth[0]) {
        await rest(`OAuthAccount?id=eq.${oauth[0].id}`, {
          method: 'PATCH',
          prefer: 'return=representation',
          body: tokenPayload,
        });
        console.log('Updated OAuthAccount google for', email);
      } else {
        await rest('OAuthAccount', {
          method: 'POST',
          prefer: 'return=representation',
          body: {
            id: createId(),
            userId: user.id,
            provider: 'google',
            ...tokenPayload,
            createdAt: now,
          },
        });
        console.log('Created OAuthAccount google for', email);
      }
    }

    // Default Mon–Fri schedule if missing
    const sched = await rest(
      `DailyScheduleTemplate?select=id&userId=eq.${user.id}&limit=1`,
    );
    if (!sched.length) {
      for (const weekday of [1, 2, 3, 4, 5]) {
        const templateId = createId();
        await rest('DailyScheduleTemplate', {
          method: 'POST',
          prefer: 'return=representation',
          body: {
            id: templateId,
            userId: user.id,
            weekday,
            workStart: '09:00',
            workEnd: '17:00',
            createdAt: now,
            updatedAt: now,
          },
        });
        await rest('Break', {
          method: 'POST',
          prefer: 'return=representation',
          body: {
            id: createId(),
            templateId,
            name: 'Lunch',
            start: '12:00',
            end: '13:00',
          },
        });
      }
      console.log('Seeded default schedule for', email);
    }
  }


  // Migrate tasks + schedules from local-app.json
  const appFile = resolve(__dirname, '../data/local-app.json');
  if (existsSync(appFile)) {
    const app = JSON.parse(readFileSync(appFile, 'utf8'));
    const emailToUser = {};
    for (const u of users) {
      const email = String(u.email).toLowerCase();
      const rows = await rest(
        `User?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
      );
      if (rows[0]) emailToUser[u.id] = rows[0].id;
    }
    let taskCount = 0;
    for (const t of app.tasks || []) {
      const dbUserId = emailToUser[t.userId];
      if (!dbUserId) continue;
      const existing = await rest(
        `Task?select=id&userId=eq.${dbUserId}&date=eq.${t.date}&name=eq.${encodeURIComponent(t.name)}&limit=1`,
      );
      if (existing[0]) continue;
      const now = new Date().toISOString();
      await rest('Task', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: createId(),
          userId: dbUserId,
          date: t.date,
          name: t.name,
          estimatedMinutes: t.estimatedMinutes,
          status: t.status || 'pending',
          order: t.order ?? 0,
          scheduledStart: t.scheduledStart,
          scheduledEnd: t.scheduledEnd,
          createdAt: now,
          updatedAt: now,
        },
      });
      taskCount += 1;
    }
    console.log(`Pushed ${taskCount} tasks from local-app.json`);
  }

  console.log('Done. Check User / OAuthAccount / Task in the Supabase Table Editor.');

}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
