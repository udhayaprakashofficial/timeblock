import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ThemePreference } from '@timeblock/shared-types';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('auth-config')
  authConfig() {
    return this.usersService.authConfig();
  }

  /** Soft auth check — returns JSON `null` (200) when logged out instead of 401. */
  @Get('me')
  async me(@Req() req: Request, @Res() res: Response) {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(200).json(null);
    }
    const me = await this.usersService.getMe(userId);
    return res.status(200).json(me);
  }

  @Patch('me')
  async updateMe(
    @Req() req: Request,
    @Res() res: Response,
    @Body()
    body: {
      name?: string;
      email?: string;
      theme?: ThemePreference;
      timezone?: string;
      defaultTaskMinutes?: number;
    },
  ) {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    const me = await this.usersService.updateProfile(userId, body);
    return res.json(me);
  }

  @Post('dev-login')
  async devLogin(@Req() req: Request, @Res() res: Response) {
    const config = this.usersService.authConfig();
    if (!config.allowDevLogin) {
      return res.status(403).json({
        error: 'Dev login is disabled in this environment',
      });
    }
    try {
      const user = await this.usersService.ensureDevUser();
      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to save session' });
        }
        return this.usersService
          .getMe(user.id)
          .then((me) => res.json(me))
          .catch((e) => res.status(500).json({ error: String(e) }));
      });
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
