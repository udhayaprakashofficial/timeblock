import { Injectable, OnModuleInit } from '@nestjs/common';
import passport = require('passport');
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { CalendarProvider } from '@prisma/client';
import type { Request } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { AuthService } from './auth.service';

/**
 * Registers / hot-reloads the Passport Google strategy from env (or UI setup).
 */
@Injectable()
export class GoogleOAuthRegistrar implements OnModuleInit {
  constructor(private readonly authService: AuthService) {}

  onModuleInit() {
    this.registerFromEnv();
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() &&
        process.env.GOOGLE_CLIENT_SECRET?.trim(),
    );
  }

  registerFromEnv() {
    this.register(
      process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
      process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
    );
  }

  register(clientID: string, clientSecret: string) {
    const callbackURL =
      process.env.GOOGLE_CALLBACK_URL?.trim() ||
      'http://localhost:3001/api/auth/google/callback';

    // Passport requires non-empty strings; real values checked at request time
    const id = clientID || 'not-configured';
    const secret = clientSecret || 'not-configured';

    try {
      passport.unuse('google');
    } catch {
      // strategy may not exist yet
    }

    const verify = async (
      req: Request,
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: (err: Error | null, user?: false | object) => void,
    ) => {
      if (
        !process.env.GOOGLE_CLIENT_ID?.trim() ||
        !process.env.GOOGLE_CLIENT_SECRET?.trim()
      ) {
        return done(new Error('Google OAuth is not configured'));
      }
      const email = profile.emails?.[0]?.value;
      if (!email) {
        return done(new Error('Google profile missing email'));
      }
      try {
        const user = await this.authService.upsertOAuthUser({
          provider: CalendarProvider.google,
          providerAccountId: profile.id,
          email,
          name: profile.displayName || email,
          accessToken,
          refreshToken,
          scope: 'calendar.readonly email profile',
          linkToUserId: req.session?.userId,
        });
        done(null, user);
      } catch (err) {
        done(err as Error);
      }
    };

    passport.use(
      'google',
      new GoogleStrategy(
        {
          clientID: id,
          clientSecret: secret,
          callbackURL,
          passReqToCallback: true,
          scope: [
            'email',
            'profile',
            'https://www.googleapis.com/auth/calendar.readonly',
          ],
        },
        verify as never,
      ),
    );

    console.log(
      `[auth] Google OAuth ${
        clientID && clientSecret ? 'enabled' : 'waiting for credentials'
      }`,
    );
  }

  /** Persist credentials to .env and hot-reload the Passport strategy (no restart). */
  saveCredentials(clientId: string, clientSecret: string) {
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (!id || !secret) {
      throw new Error('Client ID and Client Secret are required');
    }
    if (!id.includes('.apps.googleusercontent.com') && !id.includes('google')) {
      // soft check — Google client IDs usually end with this
    }

    const envPaths = [
      resolve(__dirname, '../../.env'),
      resolve(__dirname, '../../../../.env'),
    ];

    for (const envPath of envPaths) {
      if (!existsSync(envPath)) continue;
      let content = readFileSync(envPath, 'utf8');
      content = upsertEnv(content, 'GOOGLE_CLIENT_ID', id);
      content = upsertEnv(content, 'GOOGLE_CLIENT_SECRET', secret);
      content = upsertEnv(
        content,
        'GOOGLE_CALLBACK_URL',
        process.env.GOOGLE_CALLBACK_URL?.trim() ||
          'http://localhost:3001/api/auth/google/callback',
      );
      writeFileSync(envPath, content, 'utf8');
    }

    process.env.GOOGLE_CLIENT_ID = id;
    process.env.GOOGLE_CLIENT_SECRET = secret;
    process.env.GOOGLE_CALLBACK_URL =
      process.env.GOOGLE_CALLBACK_URL?.trim() ||
      'http://localhost:3001/api/auth/google/callback';

    this.register(id, secret);
    return { ok: true, googleConfigured: true };
  }
}

function upsertEnv(content: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    return content.replace(re, line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}
