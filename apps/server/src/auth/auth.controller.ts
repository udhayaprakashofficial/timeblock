import {
  Body,
  Controller,
  Get,
  Inject,
  Next,
  Post,
  Query,
  Req,
  Res,
  forwardRef,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import passport = require('passport');
import { ClerkAuthService } from './clerk-auth.service';
import { GoogleOAuthRegistrar } from './google-oauth.registrar';
import { LoginCodeService } from './login-code.service';
import { UsersService } from '../users/users.service';
import { CalendarSyncService } from '../calendar/calendar-sync.service';

function primaryWebOrigin(req?: Request): string {
  const allowed = (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Prefer localhost:5173 for local Google GIS / cookies
  const preferred = 'http://localhost:5173';
  const fallback = allowed.includes(preferred)
    ? preferred
    : (allowed[0] ?? preferred);

  // Prefer the origin the user started from (so post-login lands on the same host)
  const candidates = [
    req?.session?.oauthWebOrigin,
    typeof req?.headers?.origin === 'string' ? req.headers.origin : null,
    (() => {
      const ref = req?.headers?.referer;
      if (!ref || typeof ref !== 'string') return null;
      try {
        return new URL(ref).origin;
      } catch {
        return null;
      }
    })(),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (allowed.includes(c)) return c;
  }
  return fallback;
}

function safeReturnPath(raw: string | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  // Always land on dashboard after auth — drop auth UI query flags
  try {
    const u = new URL(raw, 'http://local');
    u.searchParams.delete('mode');
    u.searchParams.delete('authError');
    u.searchParams.delete('loginCode');
    const path = u.pathname + u.search;
    return path === '' ? '/' : path;
  } catch {
    return fallback;
  }
}

function setSessionUser(
  req: Request,
  _res: Response,
  userId: string,
  onDone: (err?: Error) => void,
) {
  const finish = (err?: Error) => onDone(err);
  // Prefer in-place update — regenerate can race with the next /me after signup
  if (req.session) {
    req.session.userId = userId;
    req.session.save((err) => finish(err ?? undefined));
    return;
  }
  finish(new Error('No session'));
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly clerkAuth: ClerkAuthService,
    private readonly googleOAuth: GoogleOAuthRegistrar,
    private readonly usersService: UsersService,
    private readonly loginCodes: LoginCodeService,
    @Inject(forwardRef(() => CalendarSyncService))
    private readonly calendarSync: CalendarSyncService,
  ) {}

  /**
   * Exchange Clerk session (after Google sign-in) for an app DB session.
   */
  @Post('clerk')
  async clerkLogin(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { token?: string },
  ) {
    const token = body.token?.trim();
    if (!token) {
      return res.status(400).json({ error: 'Missing Clerk token' });
    }
    try {
      const user = await this.clerkAuth.syncFromToken(token);
      setSessionUser(req, res, user.id, async (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to save session' });
        }
        const me = await this.usersService.getMe(user.id);
        return res.json(me);
      });
    } catch (e) {
      return res.status(401).json({
        error: e instanceof Error ? e.message : 'Clerk login failed',
      });
    }
  }

  /**
   * Browser Google Identity Services: access token + profile from the browser
   * (avoids server-side token exchange when the API cannot reach Google).
   */
  @Post('google/browser')
  async googleBrowser(
    @Req() req: Request,
    @Res() res: Response,
    @Body()
    body: {
      accessToken?: string;
      refreshToken?: string;
      email?: string;
      name?: string;
      googleId?: string;
    },
  ) {
    try {
      const me = await this.usersService.loginWithGoogleBrowser({
        accessToken: body.accessToken ?? '',
        refreshToken: body.refreshToken,
        email: body.email ?? '',
        name: body.name ?? '',
        googleId: body.googleId ?? '',
      });
      setSessionUser(req, res, me.id, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to save session' });
        }
        if (!me.id.startsWith('local_')) {
          void this.calendarSync.syncNow(me.id).catch(() => undefined);
        }
        return res.json(me);
      });
    } catch (e) {
      return res.status(401).json({
        error: e instanceof Error ? e.message : 'Google browser login failed',
      });
    }
  }

  @Post('signup')
  async signup(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { email?: string; password?: string; name?: string },
  ) {
    try {
      const me = await this.usersService.signupWithPassword({
        email: body.email ?? '',
        password: body.password ?? '',
        name: body.name,
      });
      setSessionUser(req, res, me.id, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to save session' });
        }
        return res.json(me);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign up failed';
      const status =
        msg.includes('already exists') || msg.includes('required') || msg.includes('characters')
          ? 400
          : 500;
      return res.status(status).json({ error: msg });
    }
  }

  @Post('signin')
  async signin(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { email?: string; password?: string },
  ) {
    try {
      const me = await this.usersService.signinWithPassword({
        email: body.email ?? '',
        password: body.password ?? '',
      });
      setSessionUser(req, res, me.id, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to save session' });
        }
        return res.json(me);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign in failed';
      return res.status(401).json({ error: msg });
    }
  }

  /**
   * Finish Google OAuth: one-time code → session cookie via Vite proxy → dashboard.
   */
  @Post('exchange')
  exchange(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { code?: string },
  ) {
    const code = body.code?.trim();
    if (!code) {
      return res.status(400).json({ error: 'Missing login code' });
    }
    const userId = this.loginCodes.resolve(code);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired login code' });
    }
    setSessionUser(req, res, userId, async (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to save session' });
      }
      try {
        const me = await this.usersService.getMe(userId);
        this.loginCodes.invalidate(code);
        void this.calendarSync.syncNow(userId).catch(() => undefined);
        return res.json(me);
      } catch (e) {
        return res.status(500).json({
          error: e instanceof Error ? e.message : 'Failed to load user',
        });
      }
    });
  }

  @Get('google')
  googleAuth(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
    @Query('returnTo') returnTo?: string,
  ) {
    if (!this.googleOAuth.isConfigured()) {
      return res.redirect(
        `${primaryWebOrigin(req)}/?authError=google_not_configured`,
      );
    }

    // Always return to dashboard after Google sign-in
    req.session.oauthReturnTo = '/';
    const originHeader = req.headers.origin;
    if (typeof originHeader === 'string' && originHeader) {
      req.session.oauthWebOrigin = originHeader;
    } else if (typeof req.headers.referer === 'string') {
      try {
        req.session.oauthWebOrigin = new URL(req.headers.referer).origin;
      } catch {
        /* ignore */
      }
    }
    void returnTo; // dashboard only
    req.session.save((err) => {
      if (err) {
        return res.redirect(`${primaryWebOrigin(req)}/?authError=session`);
      }
      passport.authenticate('google', {
        session: false,
        scope: [
          'email',
          'profile',
          'https://www.googleapis.com/auth/calendar.readonly',
        ],
        accessType: 'offline',
        prompt: 'consent',
      } as passport.AuthenticateOptions)(req, res, next);
    });
  }

  @Get('google/callback')
  googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    passport.authenticate(
      'google',
      { session: false },
      (
        err: Error | null,
        user: { id: string } | false | undefined,
        _info?: unknown,
      ) => {
        const web = primaryWebOrigin(req);
        if (err || !user || !user.id) {
          console.error('[auth/google] callback failed', err?.message ?? _info);
          // Common when this host cannot reach oauth2.googleapis.com for token exchange
          const reason =
            err?.message?.includes('access token') ||
            String(_info ?? '').includes('access token')
              ? 'google_token'
              : 'google';
          return res.redirect(`${web}/?authError=${reason}`);
        }
        const code = this.loginCodes.issue(user.id);
        // Dashboard only
        res.redirect(`${web}/?loginCode=${encodeURIComponent(code)}`);
      },
    )(req, res, next);
  }

  @Get('microsoft')
  microsoftAuth(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
    @Query('returnTo') returnTo?: string,
  ) {
    if (
      !process.env.MICROSOFT_CLIENT_ID?.trim() ||
      !process.env.MICROSOFT_CLIENT_SECRET?.trim()
    ) {
      return res.redirect(
        `${primaryWebOrigin(req)}/?authError=microsoft_not_configured`,
      );
    }

    req.session.oauthReturnTo = safeReturnPath(returnTo, '/');
    if (typeof req.headers.referer === 'string') {
      try {
        req.session.oauthWebOrigin = new URL(req.headers.referer).origin;
      } catch {
        /* ignore */
      }
    }
    req.session.save((err) => {
      if (err) {
        return res.redirect(`${primaryWebOrigin(req)}/?authError=session`);
      }
      passport.authenticate('microsoft', { session: false })(req, res, next);
    });
  }

  @Get('microsoft/callback')
  microsoftCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    passport.authenticate(
      'microsoft',
      { session: false },
      (
        err: Error | null,
        user: { id: string } | false | undefined,
        _info?: unknown,
      ) => {
        const web = primaryWebOrigin(req);
        if (err || !user || !user.id) {
          return res.redirect(`${web}/?authError=microsoft`);
        }
        const returnPath = safeReturnPath(req.session.oauthReturnTo, '/');
        const code = this.loginCodes.issue(user.id);
        const sep = returnPath.includes('?') ? '&' : '?';
        res.redirect(
          `${web}${returnPath}${sep}loginCode=${encodeURIComponent(code)}`,
        );
      },
    )(req, res, next);
  }

  @Post('logout')
  logout(@Req() req: Request, @Res() res: Response) {
    req.session.destroy(() => {
      res.clearCookie('timeblock.sid');
      res.json({ ok: true });
    });
  }

  @Get('session')
  session(@Req() req: Request) {
    return {
      authenticated: Boolean(req.session.userId),
      userId: req.session.userId ?? null,
    };
  }
}
