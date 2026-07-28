import { AppError, ErrorCode, type SocialProvider } from '@social-publisher/shared';

import { getProviderPolicy } from '../policies';
import type {
  AuthorizationCodeInput,
  AuthorizationInput,
  ProviderCapabilities,
  ProviderPage,
  ProviderPostInput,
  ProviderPublishResult,
  ProviderPublishStatus,
  ProviderValidationResult,
  SocialConnection,
  SocialConnector,
  SocialProfile,
  SocialTokenResult,
} from '../types';
import { validatePostAgainstPolicy } from '../validate';

/**
 * Marcadores determinísticos que o texto do post pode conter para simular cenários
 * (exclusivos de desenvolvimento/teste — o registry impede uso em modo live):
 *
 *   [[mock:fail]]        → conteúdo rejeitado pelo provedor (erro definitivo)
 *   [[mock:ratelimit]]   → HTTP 429 (erro temporário, retryable)
 *   [[mock:unavailable]] → HTTP 503 (erro temporário, retryable)
 *   [[mock:slow]]        → publica, mas o processamento demora N consultas de status
 *   [[mock:flaky]]       → falha temporária na 1ª tentativa e publica nas seguintes
 */
export const MOCK_MARKERS = {
  fail: '[[mock:fail]]',
  rateLimit: '[[mock:ratelimit]]',
  unavailable: '[[mock:unavailable]]',
  slow: '[[mock:slow]]',
  flaky: '[[mock:flaky]]',
} as const;

const SLOW_STATUS_CHECKS_UNTIL_PUBLISHED = 2;

/** Hash FNV-1a simples — determinístico e sem dependência de node:crypto (roda no browser). */
function deterministicHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class FakeConnector implements SocialConnector {
  readonly provider: SocialProvider;

  // Estado apenas para simular "processamento demorado" ([[mock:slow]]).
  private readonly pendingStatusChecks = new Map<string, number>();

  // Estado apenas para simular instabilidade ([[mock:flaky]]): 1ª chamada falha.
  private readonly flakyAttempts = new Map<string, number>();

  constructor(provider: SocialProvider) {
    this.provider = provider;
  }

  async getAuthorizationUrl(input: AuthorizationInput): Promise<string> {
    // String manual em vez de `new URL`: este pacote compila sem libs de DOM/Node.
    const code = encodeURIComponent(`mock-code-${this.provider}-${input.userId}`);
    const separator = input.redirectUri.includes('?') ? '&' : '?';
    return `${input.redirectUri}${separator}code=${code}&mock=true`;
  }

  async exchangeAuthorizationCode(input: AuthorizationCodeInput): Promise<SocialTokenResult> {
    if (!input.code.startsWith('mock-code-')) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Código de autorização mock inválido.',
        400,
      );
    }
    return {
      accessToken: `mock-access-token-${this.provider}`,
      refreshToken: `mock-refresh-token-${this.provider}`,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      scopes: [`mock:${this.provider}:read`, `mock:${this.provider}:publish`],
    };
  }

  async refreshAccessToken(_connection: SocialConnection): Promise<SocialTokenResult> {
    return {
      accessToken: `mock-access-token-${this.provider}-refreshed`,
      refreshToken: `mock-refresh-token-${this.provider}`,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      scopes: [`mock:${this.provider}:read`, `mock:${this.provider}:publish`],
    };
  }

  async revokeConnection(_connection: SocialConnection): Promise<void> {
    // Mock: nada a revogar externamente.
  }

  async getProfile(_connection: SocialConnection): Promise<SocialProfile> {
    return {
      externalAccountId: `mock-${this.provider}-account-1`,
      username: `mock_${this.provider}`,
      displayName: `Conta Mock (${this.provider})`,
      avatarUrl: `https://mock.social/avatars/${this.provider}.png`,
      // Instagram só publica via API com conta profissional — o mock reflete isso.
      accountType: this.provider === 'instagram' ? 'business' : 'standard',
    };
  }

  async getCapabilities(_connection: SocialConnection): Promise<ProviderCapabilities> {
    const { provider: _provider, ...capabilities } = getProviderPolicy(this.provider);
    return capabilities;
  }

  async validatePost(
    input: ProviderPostInput,
    _capabilities: ProviderCapabilities,
  ): Promise<ProviderValidationResult> {
    return validatePostAgainstPolicy(
      {
        text: input.text,
        media: input.media.map((m) => ({ mimeType: m.mimeType, altText: m.altText })),
      },
      getProviderPolicy(this.provider),
    );
  }

  async publish(
    input: ProviderPostInput,
    connection: SocialConnection,
  ): Promise<ProviderPublishResult> {
    const text = input.text ?? '';

    if (text.includes(MOCK_MARKERS.rateLimit)) {
      throw new AppError(ErrorCode.RATE_LIMITED, `Mock: rate limit do ${this.provider}.`, 429, true);
    }
    if (text.includes(MOCK_MARKERS.unavailable)) {
      throw new AppError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `Mock: ${this.provider} indisponível.`,
        503,
        true,
      );
    }
    if (text.includes(MOCK_MARKERS.fail)) {
      throw new AppError(
        ErrorCode.PROVIDER_REJECTED_CONTENT,
        `Mock: conteúdo rejeitado pelo ${this.provider}.`,
        422,
        false,
      );
    }
    if (text.includes(MOCK_MARKERS.flaky)) {
      const flakyKey = `${connection.id}:${deterministicHash(text)}`;
      const attempt = (this.flakyAttempts.get(flakyKey) ?? 0) + 1;
      this.flakyAttempts.set(flakyKey, attempt);
      if (attempt === 1) {
        throw new AppError(
          ErrorCode.PROVIDER_UNAVAILABLE,
          `Mock: instabilidade transitória do ${this.provider} (tentativa ${attempt}).`,
          503,
          true,
        );
      }
    }

    // Revalida imediatamente antes de "chamar a API externa", como um conector real faria.
    const validation = await this.validatePost(input, await this.getCapabilities(connection));
    if (!validation.valid) {
      const first = validation.errors[0];
      throw new AppError(
        (first?.code as ErrorCode) ?? ErrorCode.PROVIDER_REJECTED_CONTENT,
        first?.message ?? 'Conteúdo inválido para o provedor.',
        422,
        false,
      );
    }

    const id = `mock-${this.provider}-${deterministicHash(`${connection.id}:${text}`)}`;
    if (text.includes(MOCK_MARKERS.slow)) {
      this.pendingStatusChecks.set(id, SLOW_STATUS_CHECKS_UNTIL_PUBLISHED);
    }
    return {
      externalPublicationId: id,
      externalUrl: `https://mock.social/${this.provider}/${id}`,
    };
  }

  async listPages(_connection: SocialConnection): Promise<ProviderPage[]> {
    if (this.provider !== 'facebook_page') {
      throw new AppError(
        ErrorCode.ACCOUNT_NOT_SUPPORTED,
        `O provedor ${this.provider} não possui Páginas.`,
        400,
      );
    }
    return [
      {
        pageId: 'mock-fb-page-1',
        pageName: 'Página Mock Principal',
        pageAvatarUrl: 'https://mock.social/avatars/fb-page-1.png',
        // Exercita o caminho real de criptografia/uso do page token em modo mock.
        pageAccessToken: 'mock-page-token-1',
      },
      {
        pageId: 'mock-fb-page-2',
        pageName: 'Página Mock Secundária',
        pageAvatarUrl: 'https://mock.social/avatars/fb-page-2.png',
        pageAccessToken: 'mock-page-token-2',
      },
    ];
  }

  async getPublishStatus(
    externalPublicationId: string,
    _connection: SocialConnection,
  ): Promise<ProviderPublishStatus> {
    const remaining = this.pendingStatusChecks.get(externalPublicationId);
    if (remaining !== undefined && remaining > 0) {
      this.pendingStatusChecks.set(externalPublicationId, remaining - 1);
      return { status: 'processing' };
    }
    this.pendingStatusChecks.delete(externalPublicationId);
    return {
      status: 'published',
      externalUrl: `https://mock.social/${this.provider}/${externalPublicationId}`,
    };
  }
}
