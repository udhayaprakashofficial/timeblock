import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';

export const ADMIN_EMAIL = 'udhayaprakashmohan@gmail.com';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedException('Not authenticated');
    const me = await this.users.getMe(userId);
    if (me.email.trim().toLowerCase() !== ADMIN_EMAIL) {
      throw new ForbiddenException('Admin only');
    }
    return true;
  }
}
