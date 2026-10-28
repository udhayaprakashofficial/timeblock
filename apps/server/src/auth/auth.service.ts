import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { CalendarProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(forwardRef(() => UsersService))
    private readonly users: UsersService,
    @Optional() private readonly supabase?: SupabaseRestService,
  ) {}

  async upsertOAuthUser(input: {
    provider: CalendarProvider;
    providerAccountId: string;
    email: string;
    name: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    scope?: string;
    /** If already logged in, attach this calendar to the current user */
    linkToUserId?: string;
  }) {
    // Prefer Supabase REST on Vercel — Prisma :5432 is often unreachable from serverless.
    if (
      this.supabase?.isConfigured() &&
      input.provider === CalendarProvider.google
    ) {
      try {
        await this.supabase.ping();
        const email = input.email.trim().toLowerCase();
        const prior = await this.supabase.getUserByEmail(email);
        const isNew = !prior;
        const user = await this.supabase.upsertGoogleUser({
          email,
          name: input.name,
          googleId: input.providerAccountId,
          accessTokenEncrypted: this.crypto.encrypt(input.accessToken),
          refreshTokenEncrypted: input.refreshToken
            ? this.crypto.encrypt(input.refreshToken)
            : null,
        });
        if (input.scope) {
          try {
            const rows = await this.supabase.select<{ id: string }>(
              'OAuthAccount',
              'id',
              {
                filter: `userId=eq.${user.id}&provider=eq.google`,
                limit: 1,
              },
            );
            if (rows[0]?.id) {
              await this.supabase.patch('OAuthAccount', `id=eq.${rows[0].id}`, {
                scope: input.scope,
                updatedAt: new Date().toISOString(),
              });
            }
          } catch {
            /* scope is best-effort */
          }
        }
        if (isNew) {
          await this.users.deliverWelcomeEmail(user.id, email, input.name, {
            firstSignup: true,
          });
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          onboardingCompleted: user.onboardingCompleted ?? false,
        };
      } catch (restErr) {
        console.warn(
          '[auth] Supabase OAuth upsert failed — trying Prisma',
          restErr instanceof Error ? restErr.message : restErr,
        );
      }
    }

    const existingAccount = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
    });

    let user =
      existingAccount &&
      (await this.prisma.user.findUnique({ where: { id: existingAccount.userId } }));

    // Prefer linking to the already-authenticated session user when connecting a second calendar
    if (!user && input.linkToUserId) {
      user = await this.prisma.user.findUnique({
        where: { id: input.linkToUserId },
      });
    }

    if (!user) {
      user = await this.prisma.user.findUnique({ where: { email: input.email } });
    }

    let isNew = false;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          onboardingCompleted: false,
        },
      });
      isNew = true;
    } else if (user.onboardingCompleted !== true) {
      // Returning account — never send them through first-time setup again
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { onboardingCompleted: true },
      });
    }

    await this.prisma.oAuthAccount.upsert({
      where: {
        userId_provider: {
          userId: user.id,
          provider: input.provider,
        },
      },
      create: {
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        accessTokenEncrypted: this.crypto.encrypt(input.accessToken),
        refreshTokenEncrypted: input.refreshToken
          ? this.crypto.encrypt(input.refreshToken)
          : null,
        expiresAt: input.expiresAt,
        scope: input.scope,
      },
      update: {
        providerAccountId: input.providerAccountId,
        accessTokenEncrypted: this.crypto.encrypt(input.accessToken),
        refreshTokenEncrypted: input.refreshToken
          ? this.crypto.encrypt(input.refreshToken)
          : undefined,
        expiresAt: input.expiresAt,
        scope: input.scope,
      },
    });

    if (isNew) {
      await this.users.deliverWelcomeEmail(user.id, input.email, input.name, {
        firstSignup: true,
      });
    }

    return user;
  }

  async getDecryptedTokens(userId: string, provider: CalendarProvider) {
    try {
      const account = await this.prisma.oAuthAccount.findUnique({
        where: { userId_provider: { userId, provider } },
      });
      if (account) {
        return {
          accessToken: this.crypto.decrypt(account.accessTokenEncrypted),
          refreshToken: account.refreshTokenEncrypted
            ? this.crypto.decrypt(account.refreshTokenEncrypted)
            : null,
          expiresAt: account.expiresAt,
          accountId: account.id,
        };
      }
    } catch {
      /* try REST */
    }

    if (this.supabase?.isConfigured()) {
      const account = await this.supabase.getOAuthAccount(userId, provider);
      if (!account) return null;
      return {
        accessToken: this.crypto.decrypt(account.accessTokenEncrypted),
        refreshToken: account.refreshTokenEncrypted
          ? this.crypto.decrypt(account.refreshTokenEncrypted)
          : null,
        expiresAt: account.expiresAt ? new Date(account.expiresAt) : null,
        accountId: account.id,
      };
    }
    return null;
  }

  async updateTokens(
    accountId: string,
    accessToken: string,
    refreshToken?: string | null,
    expiresAt?: Date | null,
  ) {
    const data = {
      accessTokenEncrypted: this.crypto.encrypt(accessToken),
      ...(refreshToken
        ? { refreshTokenEncrypted: this.crypto.encrypt(refreshToken) }
        : {}),
      ...(expiresAt !== undefined
        ? { expiresAt: expiresAt?.toISOString?.() ?? expiresAt }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.prisma.oAuthAccount.update({
        where: { id: accountId },
        data: {
          accessTokenEncrypted: data.accessTokenEncrypted,
          ...(refreshToken
            ? { refreshTokenEncrypted: this.crypto.encrypt(refreshToken) }
            : {}),
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        },
      });
      return;
    } catch {
      /* REST */
    }
    if (this.supabase?.isConfigured()) {
      await this.supabase.patch('OAuthAccount', `id=eq.${accountId}`, {
        accessTokenEncrypted: data.accessTokenEncrypted,
        ...(refreshToken
          ? { refreshTokenEncrypted: this.crypto.encrypt(refreshToken) }
          : {}),
        ...(expiresAt !== undefined
          ? { expiresAt: expiresAt ? expiresAt.toISOString() : null }
          : {}),
        updatedAt: data.updatedAt,
      });
    }
  }
}
