import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { AppError, ErrorCode, type SocialProvider } from '@social-publisher/shared';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';

export interface OAuthStatePayload {
  userId: string;
  provider: SocialProvider;
  codeVerifier?: string;
}

const STATE_TTL_SECONDS = 600;

/**
 * Estado temporário do fluxo OAuth, em Redis com expiração. O consumo é destrutivo
 * (GETDEL): reusar o mesmo state — replay do callback — falha na segunda vez.
 */
@Injectable()
export class OAuthStateService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async create(payload: OAuthStatePayload): Promise<{ state: string; codeChallenge?: string }> {
    const state = randomBytes(24).toString('base64url');

    let codeChallenge: string | undefined;
    if (payload.provider === 'x') {
      // OAuth 2.0 Authorization Code + PKCE (S256), exigido pelo X.
      const codeVerifier = randomBytes(48).toString('base64url');
      codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      payload = { ...payload, codeVerifier };
    }

    await this.redis.set(`oauth-state:${state}`, JSON.stringify(payload), 'EX', STATE_TTL_SECONDS);
    return { state, codeChallenge };
  }

  async consume(state: string, expected: { userId: string; provider: SocialProvider }): Promise<OAuthStatePayload> {
    const raw = await this.redis.getdel(`oauth-state:${state}`);
    if (!raw) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Estado de autorização inválido ou expirado. Inicie a conexão novamente.',
        400,
      );
    }
    const payload = JSON.parse(raw) as OAuthStatePayload;
    if (payload.userId !== expected.userId || payload.provider !== expected.provider) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Estado de autorização não corresponde a esta sessão.',
        400,
      );
    }
    return payload;
  }
}
