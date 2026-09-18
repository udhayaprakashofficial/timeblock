import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-microsoft';
import { CalendarProvider } from '@prisma/client';
import type { Request } from 'express';
import { AuthService } from './auth.service';

type MsProfile = {
  id: string;
  displayName?: string;
  emails?: Array<{ value: string }>;
  _json?: { mail?: string; userPrincipalName?: string };
};

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy, 'microsoft') {
  constructor(private readonly authService: AuthService) {
    super({
      clientID: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      callbackURL:
        process.env.MICROSOFT_CALLBACK_URL ??
        'http://localhost:3001/api/auth/microsoft/callback',
      scope: ['user.read', 'calendars.read', 'offline_access'],
      tenant: process.env.MICROSOFT_TENANT_ID ?? 'common',
      passReqToCallback: true,
    } as ConstructorParameters<typeof Strategy>[0]);
  }

  async validate(
    req: Request,
    accessToken: string,
    refreshToken: string,
    profile: MsProfile,
  ) {
    const email =
      profile.emails?.[0]?.value ||
      profile._json?.mail ||
      profile._json?.userPrincipalName;
    if (!email) {
      throw new Error('Microsoft profile missing email');
    }
    return this.authService.upsertOAuthUser({
      provider: CalendarProvider.microsoft,
      providerAccountId: profile.id,
      email,
      name: profile.displayName || email,
      accessToken,
      refreshToken,
      scope: 'user.read calendars.read offline_access',
      linkToUserId: req.session?.userId,
    });
  }
}
