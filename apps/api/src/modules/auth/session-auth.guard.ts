import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { AppError, ErrorCode } from '@social-publisher/shared';
import type { FastifyRequest } from 'fastify';

import { AuthService } from './auth.service';
import { SESSION_COOKIE_NAME, toPublicUser } from './session.util';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Autenticação necessária.', 401);
    }

    const user = await this.authService.validateSession(token);
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sessão inválida ou expirada.', 401);
    }

    request.user = toPublicUser(user);
    return true;
  }
}
