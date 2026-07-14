import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError, ErrorCode } from '@social-publisher/shared';
import type { FastifyRequest } from 'fastify';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Baseline CSRF defense for the cookie-based session: mutating requests that carry an
 * `Origin` header must match the configured app origin. Browsers always send `Origin` on
 * cross-site fetch/XHR, so a forged cross-site request gets rejected here even though
 * `sameSite=lax` cookies already block simple form-based CSRF. Requests without an Origin
 * header (same-origin navigations, curl, server-to-server calls) are allowed through.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!MUTATING_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    if (!origin) return true;

    const allowedOrigin = this.config.get<string>('APP_URL');
    if (origin !== allowedOrigin) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Origem da requisição não permitida.', 403);
    }
    return true;
  }
}
