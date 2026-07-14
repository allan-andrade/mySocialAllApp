import { Injectable } from '@nestjs/common';
import type { User } from '@social-publisher/database';
import { AppError, ErrorCode } from '@social-publisher/shared';
import type { LoginInput, RegisterInput } from '@social-publisher/validation';
import * as argon2 from 'argon2';

import { PrismaService } from '../prisma/prisma.service';

import { generateSessionToken, hashSessionToken, SESSION_TTL_MS } from './session.util';

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

export interface SessionResult {
  user: User;
  rawToken: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: RegisterInput): Promise<SessionResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError(ErrorCode.EMAIL_ALREADY_IN_USE, 'Este e-mail já está cadastrado.', 409);
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash },
    });

    const { rawToken, expiresAt } = await this.createSession(user.id);
    return { user, rawToken, expiresAt };
  }

  async login(input: LoginInput, meta: RequestMeta = {}): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha inválidos.', 401);
    }

    const passwordValid = await argon2.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha inválidos.', 401);
    }

    const { rawToken, expiresAt } = await this.createSession(user.id, meta);
    return { user, rawToken, expiresAt };
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashSessionToken(rawToken);
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }

  async validateSession(rawToken: string): Promise<User | null> {
    const tokenHash = hashSessionToken(rawToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return session.user;
  }

  private async createSession(
    userId: string,
    meta: RequestMeta = {},
  ): Promise<{ rawToken: string; expiresAt: Date }> {
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
      },
    });

    return { rawToken, expiresAt };
  }
}
