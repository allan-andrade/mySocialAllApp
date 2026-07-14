import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, type LoginInput, registerSchema, type RegisterInput } from '@social-publisher/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { SessionAuthGuard } from './session-auth.guard';
import { SESSION_COOKIE_NAME, type PublicUser, toPublicUser } from './session.util';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: PublicUser }> {
    const { user, rawToken, expiresAt } = await this.authService.register(body);
    this.setSessionCookie(reply, rawToken, expiresAt);
    return { user: toPublicUser(user) };
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: PublicUser }> {
    const { user, rawToken, expiresAt } = await this.authService.login(body, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    this.setSessionCookie(reply, rawToken, expiresAt);
    return { user: toPublicUser(user) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ success: true }> {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await this.authService.logout(token);
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { success: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: PublicUser): { user: PublicUser } {
    return { user };
  }

  private setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }
}
