import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CalendarProvider } from '@prisma/client';
import type { AuthConfigDto, ThemePreference, UserDto } from '@timeblock/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { LocalUserStore } from '../auth/local-user.store';
import { LocalDataStore } from '../auth/local-data.store';
import { AuthService } from '../auth/auth.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { CryptoService } from '../crypto/crypto.service';
import { createId } from '../supabase/create-id';
import { normalizeTimeZone } from '../common/time.util';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localUsers: LocalUserStore,
    private readonly localData: LocalDataStore,
    private readonly supabase: SupabaseRestService,
    private readonly crypto: CryptoService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  authConfig(): AuthConfigDto {
    const googleOAuth = Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() &&
        process.env.GOOGLE_CLIENT_SECRET?.trim(),
    );
    const clerkOn = Boolean(
      process.env.CLERK_SECRET_KEY?.trim() &&
        process.env.CLERK_PUBLISHABLE_KEY?.trim(),
    );
    return {
      googleSignIn: googleOAuth || clerkOn,
      allowDevLogin:
        process.env.NODE_ENV !== 'production' &&
        process.env.ALLOW_DEV_LOGIN === 'true',
      googleCalendarOAuth: googleOAuth,
      googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
      microsoftConfigured: Boolean(
        process.env.MICROSOFT_CLIENT_ID?.trim() &&
          process.env.MICROSOFT_CLIENT_SECRET?.trim(),
      ),
      clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY?.trim() || null,
    };
  }

  async getMe(userId: string): Promise<UserDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { oauthAccounts: true },
      });
      if (!user) throw new NotFoundException('User not found');
      return this.toDto(user);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if (this.supabase.isConfigured()) {
        const user = await this.supabase.getUserById(userId);
        if (user) {
          const providers = await this.supabase.listOAuthProviders(user.id);
          return this.dtoFromParts(user, providers);
        }
        throw new NotFoundException('User not found');
      }
      throw err;
    }
  }

  /** Resolve IANA timezone for scheduling (falls back to UTC). */
  async getTimeZone(userId: string): Promise<string> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      if (user?.timezone) return normalizeTimeZone(user.timezone);
    } catch {
      /* try REST */
    }
    if (this.supabase.isConfigured()) {
      const user = await this.supabase.getUserById(userId);
      if (user?.timezone) return normalizeTimeZone(user.timezone);
    }
    return 'UTC';
  }

  /**
   * Browser Google Identity Services login (token obtained in the browser).
   * Uses Supabase when reachable; otherwise a local file store.
   */
  async loginWithGoogleBrowser(input: {
    accessToken: string;
    refreshToken?: string;
    email: string;
    name: string;
    googleId: string;
  }): Promise<UserDto> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim() || email;
    const googleId = input.googleId.trim();
    const accessToken = input.accessToken.trim();
    if (!email || !googleId || !accessToken) {
      throw new BadRequestException('Missing Google profile or access token');
    }

    const viaRest = async (): Promise<UserDto> => {
      if (!this.supabase.isConfigured()) throw new Error('REST not configured');
      await this.supabase.ping();
      const user = await this.supabase.upsertGoogleUser({
        email,
        name,
        googleId,
        accessTokenEncrypted: this.crypto.encrypt(accessToken),
        refreshTokenEncrypted: input.refreshToken
          ? this.crypto.encrypt(input.refreshToken)
          : null,
      });
      const providers = await this.supabase.listOAuthProviders(user.id);
      try {
        await this.seedDefaultScheduleRest(user.id);
      } catch (e) {
        console.warn('[auth] schedule seed via REST failed', e);
      }
      return this.dtoFromParts(user, providers);
    };

    // Prefer Supabase HTTPS REST when keys are set (works without Postgres :5432)
    if (this.supabase.isConfigured()) {
      try {
        return await viaRest();
      } catch (restErr) {
        console.warn(
          '[auth] Supabase REST failed — trying Prisma',
          restErr instanceof Error ? restErr.message : restErr,
        );
      }
    }

    try {
      const user = await this.authService.upsertOAuthUser({
        provider: CalendarProvider.google,
        providerAccountId: googleId,
        email,
        name,
        accessToken,
        refreshToken: input.refreshToken,
        scope: 'calendar.readonly email profile',
      });
      return this.getMe(user.id);
    } catch (err) {
      console.error(
        '[auth] Google login failed against Supabase',
        err instanceof Error ? err.message : err,
      );
      throw new BadRequestException(
        'Could not save account to Supabase. Check DATABASE_URL / SUPABASE keys.',
      );
    }
  }

  async updateProfile(
    userId: string,
    body: {
      name?: string;
      email?: string;
      theme?: ThemePreference;
      timezone?: string;
      defaultTaskMinutes?: number;
    },
  ): Promise<UserDto> {
    const tz =
      body.timezone !== undefined
        ? normalizeTimeZone(body.timezone)
        : undefined;
    let defaultTaskMinutes: number | undefined;
    if (body.defaultTaskMinutes !== undefined) {
      const n = Number(body.defaultTaskMinutes);
      if (!Number.isFinite(n) || n < 5 || n > 8 * 60) {
        throw new BadRequestException(
          'Default task duration must be between 5 and 480 minutes',
        );
      }
      defaultTaskMinutes = Math.round(n);
    }
    if (
      !body.name &&
      !body.email &&
      !body.theme &&
      tz === undefined &&
      defaultTaskMinutes === undefined
    ) {
      throw new BadRequestException('Nothing to update');
    }
    if (body.theme && body.theme !== 'light' && body.theme !== 'dark') {
      throw new BadRequestException('Invalid theme');
    }

    if (body.email) {
      const taken = await this.prisma.user.findFirst({
        where: { email: body.email, NOT: { id: userId } },
      });
      if (taken) throw new BadRequestException('Email already in use');
    }

    const data = {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.email ? { email: body.email.trim().toLowerCase() } : {}),
      ...(body.theme ? { theme: body.theme } : {}),
      ...(tz !== undefined ? { timezone: tz } : {}),
      ...(defaultTaskMinutes !== undefined ? { defaultTaskMinutes } : {}),
    };

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data,
      });
      return this.getMe(userId);
    } catch (err) {
      if (this.supabase.isConfigured()) {
        await this.supabase.patch('User', `id=eq.${userId}`, {
          ...data,
          updatedAt: new Date().toISOString(),
        });
        return this.getMe(userId);
      }
      throw err;
    }
  }


  private async seedDefaultScheduleRest(userId: string) {
    const existing = await this.supabase.select('DailyScheduleTemplate', 'id', {
      filter: `userId=eq.${userId}`,
      limit: 1,
    });
    if (existing.length) return;
    const now = new Date().toISOString();
    for (const weekday of [1, 2, 3, 4, 5]) {
      const templateId = createId();
      await this.supabase.insert('DailyScheduleTemplate', {
        id: templateId,
        userId,
        weekday,
        workStart: '09:00',
        workEnd: '18:00',
        createdAt: now,
        updatedAt: now,
      });
      await this.supabase.insert('Break', {
        id: createId(),
        templateId,
        name: 'Lunch',
        start: '12:00',
        end: '13:00',
      });
    }
  }

  async signupWithPassword(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<UserDto> {
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    const name = (input.name?.trim() || email.split('@')[0] || 'User').slice(0, 80);
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Valid email is required');
    }
    if (!password || password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const passwordHash = this.crypto.hashPassword(password);

    if (this.supabase.isConfigured()) {
      try {
        await this.supabase.ping();
        const existing = await this.supabase.getUserByEmail(email);
        if (existing) {
          throw new BadRequestException('An account with this email already exists');
        }
        const user = await this.supabase.createPasswordUser({
          email,
          name,
          passwordHash,
        });
        try {
          await this.seedDefaultScheduleRest(user.id);
        } catch {
          /* optional */
        }
        return this.dtoFromParts(user, []);
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        console.warn(
          '[auth] signup REST failed',
          err instanceof Error ? err.message : err,
        );
      }
    }

    try {
      const taken = await this.prisma.user.findUnique({ where: { email } });
      if (taken) {
        throw new BadRequestException('An account with this email already exists');
      }
      const user = await this.prisma.user.create({
        data: { email, name, passwordHash },
        include: { oauthAccounts: true },
      });
      return this.toDto(user);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      console.error(
        '[auth] signup failed against Supabase',
        err instanceof Error ? err.message : err,
      );
      throw new BadRequestException(
        'Could not create account in Supabase. Check DATABASE_URL / SUPABASE keys.',
      );
    }
  }

  async signinWithPassword(input: {
    email: string;
    password: string;
  }): Promise<UserDto> {
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    if (this.supabase.isConfigured()) {
      try {
        await this.supabase.ping();
        const user = await this.supabase.getUserByEmail(email);
        if (user?.passwordHash && this.crypto.verifyPassword(password, user.passwordHash)) {
          const providers = await this.supabase.listOAuthProviders(user.id);
          return this.dtoFromParts(user, providers);
        }
        if (user && !user.passwordHash) {
          throw new BadRequestException(
            'This account uses Google sign-in. Continue with Google.',
          );
        }
        if (user) {
          throw new BadRequestException('Invalid email or password');
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        console.warn(
          '[auth] signin REST failed',
          err instanceof Error ? err.message : err,
        );
      }
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
        include: { oauthAccounts: true },
      });
      if (user?.passwordHash && this.crypto.verifyPassword(password, user.passwordHash)) {
        return this.toDto(user);
      }
      if (user && !user.passwordHash) {
        throw new BadRequestException(
          'This account uses Google sign-in. Continue with Google.',
        );
      }
      if (user) {
        throw new BadRequestException('Invalid email or password');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
    }

    throw new BadRequestException('Invalid email or password');
  }

  async ensureDevUser(): Promise<{ id: string }> {
    const email = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase();
    const name = process.env.DEV_LOGIN_NAME?.trim();
    if (!email || !name) {
      throw new BadRequestException(
        'Set DEV_LOGIN_EMAIL and DEV_LOGIN_NAME in server .env for dev login',
      );
    }
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email, name },
      });
    }
    return user;
  }

  private dtoFromParts(
    user: {
      id: string;
      name: string;
      email: string;
      theme?: string | null;
      timezone?: string | null;
      defaultTaskMinutes?: number | null;
    },
    providers: string[],
  ): UserDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      theme: user.theme === 'dark' ? 'dark' : 'light',
      timezone: normalizeTimeZone(user.timezone),
      defaultTaskMinutes:
        Number.isFinite(Number(user.defaultTaskMinutes)) &&
        Number(user.defaultTaskMinutes) >= 5
          ? Math.round(Number(user.defaultTaskMinutes))
          : 30,
      connectedProviders: providers as UserDto['connectedProviders'],
    };
  }

  private toDto(user: {
    id: string;
    name: string;
    email: string;
    theme?: string | null;
    timezone?: string | null;
    defaultTaskMinutes?: number | null;
    oauthAccounts: Array<{ provider: string }>;
  }): UserDto {
    return this.dtoFromParts(
      user,
      user.oauthAccounts.map((a) => a.provider),
    );
  }
}
