import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CalendarProvider } from '@prisma/client';
import type {
  AuthConfigDto,
  TaskDto,
  ThemePreference,
  UserDto,
  Weekday,
} from '@timeblock/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { LocalUserStore } from '../auth/local-user.store';
import { LocalDataStore } from '../auth/local-data.store';
import { AuthService } from '../auth/auth.service';
import { SupabaseRestService } from '../supabase/supabase-rest.service';
import { CryptoService } from '../crypto/crypto.service';
import { createId } from '../supabase/create-id';
import { normalizeTimeZone, todayInTimeZone } from '../common/time.util';
import { SchedulerService } from '../tasks/scheduler.service';
import { TasksService } from '../tasks/tasks.service';
import { ScheduleTemplatesService } from '../schedule/schedule.service';
import { BrevoMailService } from '../mail/brevo-mail.service';

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
    @Inject(forwardRef(() => SchedulerService))
    private readonly scheduler: SchedulerService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasks: TasksService,
    private readonly schedule: ScheduleTemplatesService,
    private readonly mail: BrevoMailService,
  ) {}

  /**
   * Single round-trip for onboarding finish: mark complete, save schedule,
   * seed today's tasks (+ recurring templates). Much faster than N client calls.
   */
  async finishOnboarding(
    userId: string,
    body: {
      weekdays?: number[];
      workStart?: string;
      workEnd?: string;
      breaks?: Array<{ name: string; start: string; end: string }>;
      tasks?: Array<{
        name: string;
        estimatedMinutes: number;
        recurring?: boolean;
      }>;
      createTasks?: boolean;
      /** Browser IANA zone — must be set before seeding so tasks land on the user's civil today */
      timezone?: string;
    },
  ): Promise<{ user: UserDto; tasks: TaskDto[] }> {
    const weekdays = (
      Array.isArray(body.weekdays) && body.weekdays.length
        ? body.weekdays
        : [1, 2, 3, 4, 5]
    ).filter((d) => d >= 0 && d <= 6) as Weekday[];

    const tz = body.timezone?.trim()
      ? normalizeTimeZone(body.timezone)
      : undefined;

    // Set timezone BEFORE seeding — otherwise UTC "today" can be yesterday in IST
    // and tasks get carried into backlog while the plan looks empty.
    const user = await this.updateProfile(userId, {
      onboardingCompleted: true,
      ...(tz ? { timezone: tz } : {}),
    });

    try {
      await this.schedule.upsertSelectedDays(userId, weekdays, {
        workStart: body.workStart?.trim() || '09:00',
        workEnd: body.workEnd?.trim() || '18:00',
        breaks: (body.breaks ?? [])
          .filter((b) => b?.name?.trim())
          .map((b) => ({
            name: b.name.trim(),
            start: b.start || '12:00',
            end: b.end || '13:00',
          })),
      });
    } catch (err) {
      console.warn(
        '[onboarding] schedule save failed',
        err instanceof Error ? err.message : err,
      );
    }

    let tasks: TaskDto[] = [];
    if (body.createTasks !== false && Array.isArray(body.tasks) && body.tasks.length) {
      try {
        tasks = await this.tasks.seedOnboarding(userId, body.tasks, weekdays);
      } catch (err) {
        console.warn(
          '[onboarding] task seed failed',
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { user: { ...user, onboardingCompleted: true }, tasks };
  }

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
    if (userId.startsWith('local_')) {
      const local = this.localUsers.findById(userId);
      if (!local) throw new NotFoundException('User not found');
      const overlay = this.localUsers.getOnboardingCompleted(userId);
      return this.finalizeOnboardingFlag(
        this.dtoFromParts(
          {
            ...local,
            onboardingCompleted:
              local.onboardingCompleted === true || overlay === true
                ? true
                : local.onboardingCompleted === false
                  ? false
                  : undefined,
          },
          local.connectedProviders,
        ),
        userId,
      );
    }
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { oauthAccounts: true },
      });
      if (!user) throw new NotFoundException('User not found');
      return this.finalizeOnboardingFlag(this.toDto(user), userId);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if (this.supabase.isConfigured()) {
        const user = await this.supabase.getUserById(userId);
        if (user) {
          const providers = await this.supabase.listOAuthProviders(user.id);
          return this.finalizeOnboardingFlag(
            this.dtoFromParts(user, providers),
            userId,
          );
        }
        throw new NotFoundException('User not found');
      }
      throw err;
    }
  }

  /**
   * Onboarding is only for brand-new signups.
   * Existing / returning accounts never re-enter setup.
   */
  private async finalizeOnboardingFlag(
    dto: UserDto,
    userId: string,
  ): Promise<UserDto> {
    if (dto.onboardingCompleted === true) {
      this.localUsers.setOnboardingCompleted(userId, true);
      return dto;
    }
    if (this.localUsers.getOnboardingCompleted(userId) === true) {
      return { ...dto, onboardingCompleted: true };
    }
    // Account already has work — treat as finished even if the flag was wrong
    if (await this.userHasAnyTasks(userId)) {
      await this.persistOnboardingCompleted(userId);
      return { ...dto, onboardingCompleted: true };
    }
    return dto;
  }

  /** Returning logins skip onboarding (signup-only flow). */
  private async markReturningUserOnboarded(dto: UserDto): Promise<UserDto> {
    if (dto.onboardingCompleted === true) return dto;
    await this.persistOnboardingCompleted(dto.id);
    return { ...dto, onboardingCompleted: true };
  }

  private async persistOnboardingCompleted(userId: string): Promise<void> {
    this.localUsers.setOnboardingCompleted(userId, true);
    if (userId.startsWith('local_')) {
      const local = this.localUsers.findById(userId);
      if (local) {
        local.onboardingCompleted = true;
        this.localUsers.save(local);
      }
      return;
    }
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { onboardingCompleted: true },
      });
    } catch {
      /* REST */
    }
    if (this.supabase.isConfigured()) {
      try {
        await this.supabase.patch('User', `id=eq.${userId}`, {
          onboardingCompleted: true,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        /* column may be missing */
      }
    }
  }

  private async userHasAnyTasks(userId: string): Promise<boolean> {
    if (userId.startsWith('local_')) {
      try {
        if (this.localData.listBacklog(userId).length > 0) return true;
        const tz = await this.getTimeZone(userId);
        const today = todayInTimeZone(tz);
        return this.localData.listTasks(userId, today).length > 0;
      } catch {
        return false;
      }
    }
    try {
      const row = await this.prisma.task.findFirst({
        where: { userId },
        select: { id: true },
      });
      return Boolean(row);
    } catch {
      /* REST */
    }
    if (this.supabase.isConfigured()) {
      try {
        const rows = await this.supabase.select('Task', 'id', {
          filter: `userId=eq.${userId}`,
          limit: 1,
        });
        return rows.length > 0;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Resolve IANA timezone for scheduling (falls back to UTC). */
  async getTimeZone(userId: string): Promise<string> {
    if (userId.startsWith('local_')) {
      const local = this.localUsers.findById(userId);
      if (local?.timezone) return normalizeTimeZone(local.timezone);
      return 'UTC';
    }
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

    const viaRest = async (): Promise<{ dto: UserDto; isNew: boolean }> => {
      if (!this.supabase.isConfigured()) throw new Error('REST not configured');
      await this.supabase.ping();
      const prior = await this.supabase.getUserByEmail(email);
      const isNew = !prior;
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
      if (isNew) {
        try {
          await this.seedDefaultScheduleRest(user.id);
        } catch (e) {
          console.warn('[auth] schedule seed via REST failed', e);
        }
      }
      return { dto: this.dtoFromParts(user, providers), isNew };
    };

    // Prefer Supabase HTTPS REST when keys are set (works without Postgres :5432)
    if (this.supabase.isConfigured()) {
      try {
        const { dto, isNew } = await viaRest();
        if (isNew) {
          this.notifyWelcome(email, name);
          return { ...dto, onboardingCompleted: false };
        }
        // Existing Google account — never re-show first-time setup
        return this.markReturningUserOnboarded(dto);
      } catch (restErr) {
        console.warn(
          '[auth] Supabase REST failed — trying Prisma',
          restErr instanceof Error ? restErr.message : restErr,
        );
      }
    }

    try {
      const prior = await this.prisma.user.findUnique({ where: { email } });
      const isNew = !prior;
      const user = await this.authService.upsertOAuthUser({
        provider: CalendarProvider.google,
        providerAccountId: googleId,
        email,
        name,
        accessToken,
        refreshToken: input.refreshToken,
        scope: 'calendar.readonly gmail.send email profile',
      });
      if (isNew) {
        this.notifyWelcome(email, name);
        return { ...(await this.getMe(user.id)), onboardingCompleted: false };
      }
      return this.markReturningUserOnboarded(await this.getMe(user.id));
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
      onboardingCompleted?: boolean;
    },
  ): Promise<UserDto> {
    const tz =
      body.timezone !== undefined
        ? normalizeTimeZone(body.timezone)
        : undefined;
    const prevTz = tz !== undefined ? await this.getTimeZone(userId) : undefined;
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
      defaultTaskMinutes === undefined &&
      body.onboardingCompleted === undefined
    ) {
      throw new BadRequestException('Nothing to update');
    }
    if (body.theme && body.theme !== 'light' && body.theme !== 'dark') {
      throw new BadRequestException('Invalid theme');
    }

    if (body.email) {
      try {
        const taken = await this.prisma.user.findFirst({
          where: { email: body.email, NOT: { id: userId } },
        });
        if (taken) throw new BadRequestException('Email already in use');
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
      }
    }

    const data = {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.email ? { email: body.email.trim().toLowerCase() } : {}),
      ...(body.theme ? { theme: body.theme } : {}),
      ...(tz !== undefined ? { timezone: tz } : {}),
      ...(defaultTaskMinutes !== undefined ? { defaultTaskMinutes } : {}),
      ...(body.onboardingCompleted !== undefined
        ? { onboardingCompleted: Boolean(body.onboardingCompleted) }
        : {}),
    };

    if (body.onboardingCompleted !== undefined) {
      this.localUsers.setOnboardingCompleted(
        userId,
        Boolean(body.onboardingCompleted),
      );
    }

    if (userId.startsWith('local_')) {
      const local = this.localUsers.findById(userId);
      if (!local) throw new NotFoundException('User not found');
      if (body.name) local.name = body.name.trim();
      if (body.email) local.email = body.email.trim().toLowerCase();
      if (body.theme) local.theme = body.theme;
      if (tz) local.timezone = tz;
      if (body.onboardingCompleted !== undefined) {
        local.onboardingCompleted = Boolean(body.onboardingCompleted);
      }
      this.localUsers.save(local);
      return this.dtoFromParts(local, local.connectedProviders);
    }

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data,
      });
      await this.repackTodayIfZoneChanged(userId, prevTz, tz);
      return this.getMe(userId);
    } catch (err) {
      if (this.supabase.isConfigured()) {
        try {
          await this.supabase.patch('User', `id=eq.${userId}`, {
            ...data,
            updatedAt: new Date().toISOString(),
          });
        } catch (patchErr) {
          // Column may not exist yet on remote — still succeed for onboarding flag
          if (body.onboardingCompleted === undefined) throw patchErr;
        }
        await this.repackTodayIfZoneChanged(userId, prevTz, tz);
        const me = await this.getMe(userId);
        if (body.onboardingCompleted !== undefined) {
          return { ...me, onboardingCompleted: Boolean(body.onboardingCompleted) };
        }
        return me;
      }
      throw err;
    }
  }

  /** After the account zone changes, pack today in that local zone. */
  private async repackTodayIfZoneChanged(
    userId: string,
    prevTz: string | undefined,
    tz: string | undefined,
  ) {
    if (!tz || !prevTz || tz === prevTz) return;
    try {
      const oldToday = todayInTimeZone(prevTz);
      const newToday = todayInTimeZone(tz);
      if (oldToday !== newToday) {
        // Civil date shifted (e.g. UTC→IST overnight): move unfinished work onto the new today
        await this.tasks.moveUnfinishedDayToDate(userId, oldToday, newToday);
      }
      await this.scheduler.rescheduleDayPreferRest(userId, newToday);
    } catch (err) {
      console.warn(
        '[users] reschedule after timezone change failed',
        err instanceof Error ? err.message : err,
      );
    }
  }

  async changePassword(
    userId: string,
    body: { currentPassword?: string; newPassword?: string },
  ): Promise<{ ok: true }> {
    const next = (body.newPassword ?? '').trim();
    if (next.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const current = body.currentPassword ?? '';
    const hashed = this.crypto.hashPassword(next);

    if (userId.startsWith('local_')) {
      const local = this.localUsers.findById(userId);
      if (!local) throw new NotFoundException('User not found');
      if (
        local.passwordHash &&
        !this.crypto.verifyPassword(current, local.passwordHash)
      ) {
        throw new BadRequestException('Current password is wrong');
      }
      local.passwordHash = hashed;
      this.localUsers.save(local);
      return { ok: true };
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!user) throw new NotFoundException('User not found');
      if (
        user.passwordHash &&
        !this.crypto.verifyPassword(current, user.passwordHash)
      ) {
        throw new BadRequestException('Current password is wrong');
      }
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: hashed },
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) {
        throw err;
      }
      if (!this.supabase.isConfigured()) throw err;
      const rows = await this.supabase.select<{ passwordHash?: string | null }>(
        'User',
        'passwordHash',
        { filter: `id=eq.${userId}`, limit: 1 },
      );
      const existing = rows[0]?.passwordHash ?? null;
      if (existing && !this.crypto.verifyPassword(current, existing)) {
        throw new BadRequestException('Current password is wrong');
      }
      await this.supabase.patch('User', `id=eq.${userId}`, {
        passwordHash: hashed,
        updatedAt: new Date().toISOString(),
      });
      return { ok: true };
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

  private queueWelcome(email: string, name?: string) {
    void this.mail
      .sendWelcomeEmail({ toEmail: email, toName: name })
      .catch(() => undefined);
  }

  private notifyWelcome(email: string, name?: string) {
    void this.mail
      .sendWelcomeEmail({ toEmail: email, toName: name })
      .catch(() => undefined);
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
        this.notifyWelcome(email, name);
        return {
          ...this.dtoFromParts(user, []),
          onboardingCompleted: false,
        };
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
        data: { email, name, passwordHash, onboardingCompleted: false },
        include: { oauthAccounts: true },
      });
      this.notifyWelcome(email, name);
      return this.toDto(user);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      console.warn(
        '[auth] signup Prisma failed — using local store',
        err instanceof Error ? err.message : err,
      );
    }

    // Offline / unreachable Supabase — keep local app usable (not on Vercel)
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      throw new BadRequestException(
        'Could not create account right now. Please try again in a moment.',
      );
    }
    const existingLocal = this.localUsers.findByEmail(email);
    if (existingLocal) {
      throw new BadRequestException('An account with this email already exists');
    }
    const local = this.localUsers.upsertPassword({ email, name, passwordHash });
    local.onboardingCompleted = false;
    this.localUsers.save(local);
    try {
      this.localData.ensureDefaultSchedule(local.id);
    } catch {
      /* optional */
    }
    this.notifyWelcome(email, name);
    return {
      ...this.dtoFromParts(local, local.connectedProviders),
      onboardingCompleted: false,
    };
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
          return this.markReturningUserOnboarded(
            this.dtoFromParts(user, providers),
          );
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
        return this.markReturningUserOnboarded(this.toDto(user));
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

    const local = this.localUsers.findByEmail(email);
    if (local?.passwordHash && this.crypto.verifyPassword(password, local.passwordHash)) {
      return this.markReturningUserOnboarded(
        this.dtoFromParts(local, local.connectedProviders),
      );
    }
    if (local && !local.passwordHash) {
      throw new BadRequestException(
        'This account uses Google sign-in. Continue with Google.',
      );
    }
    if (local) {
      throw new BadRequestException('Invalid email or password');
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
      onboardingCompleted?: boolean | null;
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
      // Explicit false = first-time signup still in setup.
      // Missing/null/true = done (legacy rows never re-enter onboarding).
      onboardingCompleted: user.onboardingCompleted !== false,
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
    onboardingCompleted?: boolean | null;
    oauthAccounts: Array<{ provider: string }>;
  }): UserDto {
    return this.dtoFromParts(
      user,
      user.oauthAccounts.map((a) => a.provider),
    );
  }
}
