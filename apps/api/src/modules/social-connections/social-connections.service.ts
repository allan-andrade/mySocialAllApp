import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TokenCipher } from '@social-publisher/crypto';
import type { FacebookPageConnection, SocialConnection } from '@social-publisher/database';
import { AppError, ErrorCode, type SocialProvider } from '@social-publisher/shared';
import type {
  ConnectorRegistry,
  ProviderCapabilities,
  ProviderPage,
  SocialConnection as ConnectorConnection,
} from '@social-publisher/social-connectors';

import { CONNECTOR_REGISTRY, TOKEN_CIPHER } from '../connectors/connectors.module';
import { PrismaService } from '../prisma/prisma.service';

import { OAuthStateService } from './oauth-state.service';

export interface SocialConnectionDto {
  id: string;
  provider: SocialProvider;
  externalAccountName: string;
  username: string;
  avatarUrl: string | null;
  accountType: string | null;
  status: string;
  scopes: string[];
  tokenExpiresAt: string | null;
  createdAt: string;
  facebookPages: Array<{
    id: string;
    pageId: string;
    pageName: string;
    pageAvatarUrl: string | null;
    status: string;
  }>;
}

function toDto(
  connection: SocialConnection & { facebookPages: FacebookPageConnection[] },
): SocialConnectionDto {
  // Nunca expor tokens (nem cifrados) em respostas da API.
  return {
    id: connection.id,
    provider: connection.provider as SocialProvider,
    externalAccountName: connection.externalAccountName,
    username: connection.username,
    avatarUrl: connection.avatarUrl,
    accountType: connection.accountType,
    status: connection.status,
    scopes: connection.scopes,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    createdAt: connection.createdAt.toISOString(),
    facebookPages: connection.facebookPages.map((page) => ({
      id: page.id,
      pageId: page.pageId,
      pageName: page.pageName,
      pageAvatarUrl: page.pageAvatarUrl,
      status: page.status,
    })),
  };
}

@Injectable()
export class SocialConnectionsService {
  private readonly logger = new Logger(SocialConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly oauthState: OAuthStateService,
    @Inject(CONNECTOR_REGISTRY) private readonly registry: ConnectorRegistry,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
  ) {}

  get mode(): 'mock' | 'live' {
    return this.registry.mode;
  }

  async list(userId: string): Promise<SocialConnectionDto[]> {
    const connections = await this.prisma.socialConnection.findMany({
      where: { userId },
      include: { facebookPages: true },
      orderBy: { createdAt: 'asc' },
    });
    return connections.map(toDto);
  }

  async beginAuthorization(userId: string, provider: SocialProvider): Promise<string> {
    const connector = this.registry.get(provider);
    const redirectUri = this.callbackUri(provider);
    const { state, codeChallenge } = await this.oauthState.create({ userId, provider });

    const baseUrl = await connector.getAuthorizationUrl({ userId, redirectUri });
    const url = new URL(baseUrl);
    url.searchParams.set('state', state);
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async handleCallback(
    userId: string,
    provider: SocialProvider,
    query: { code?: string; state?: string; error?: string },
  ): Promise<SocialConnectionDto> {
    if (query.error) {
      // Usuário cancelou ou o provedor recusou o escopo.
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        `Autorização não concluída (${query.error}).`,
        400,
      );
    }
    if (!query.code || !query.state) {
      throw new AppError(ErrorCode.AUTHORIZATION_REQUIRED, 'Callback OAuth incompleto.', 400);
    }

    const statePayload = await this.oauthState.consume(query.state, { userId, provider });
    const connector = this.registry.get(provider);

    const tokens = await connector.exchangeAuthorizationCode({
      code: query.code,
      state: query.state,
      redirectUri: this.callbackUri(provider),
      codeVerifier: statePayload.codeVerifier,
    });

    // Perfil e capacidades são consultados com a conexão recém-autorizada.
    const probe: ConnectorConnection = {
      id: 'pending',
      userId,
      provider,
      externalAccountId: 'pending',
      status: 'CONNECTED',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
    const profile = await connector.getProfile(probe);
    const capabilities = await connector.getCapabilities(probe);

    if (provider === 'instagram' && profile.accountType !== 'business' && profile.accountType !== 'creator') {
      throw new AppError(
        ErrorCode.ACCOUNT_NOT_SUPPORTED,
        'A publicação no Instagram exige conta profissional (criador ou empresa).',
        400,
      );
    }

    const data = {
      externalAccountName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl ?? null,
      accountType: profile.accountType ?? null,
      encryptedAccessToken: this.cipher.encrypt(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken ? this.cipher.encrypt(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scopes,
      status: 'CONNECTED' as const,
      capabilities: capabilities as object,
      disconnectedAt: null,
    };

    const connection = await this.prisma.socialConnection.upsert({
      where: {
        userId_provider_externalAccountId: {
          userId,
          provider,
          externalAccountId: profile.externalAccountId,
        },
      },
      create: { userId, provider, externalAccountId: profile.externalAccountId, ...data },
      update: data,
      include: { facebookPages: true },
    });

    this.logger.log(
      JSON.stringify({ event: 'social_connection_connected', provider, connectionId: connection.id }),
    );
    return toDto(connection);
  }

  async getCapabilities(userId: string, connectionId: string): Promise<ProviderCapabilities> {
    const connection = await this.requireOwned(userId, connectionId);
    const connector = this.registry.get(connection.provider as SocialProvider);
    const capabilities = await connector.getCapabilities(this.toConnectorConnection(connection));
    await this.prisma.socialConnection.update({
      where: { id: connection.id },
      data: { capabilities: capabilities as object },
    });
    return capabilities;
  }

  async refresh(userId: string, connectionId: string): Promise<SocialConnectionDto> {
    const connection = await this.requireOwned(userId, connectionId);
    const connector = this.registry.get(connection.provider as SocialProvider);
    const tokens = await connector.refreshAccessToken(this.toConnectorConnection(connection));

    const updated = await this.prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        encryptedAccessToken: this.cipher.encrypt(tokens.accessToken),
        encryptedRefreshToken: tokens.refreshToken
          ? this.cipher.encrypt(tokens.refreshToken)
          : connection.encryptedRefreshToken,
        tokenExpiresAt: tokens.expiresAt ?? null,
        status: 'CONNECTED',
      },
      include: { facebookPages: true },
    });
    return toDto(updated);
  }

  async disconnect(userId: string, connectionId: string): Promise<void> {
    const connection = await this.requireOwned(userId, connectionId);
    const connector = this.registry.get(connection.provider as SocialProvider);

    try {
      await connector.revokeConnection(this.toConnectorConnection(connection));
    } catch (error) {
      // Revogação externa é melhor esforço; a remoção local dos tokens acontece sempre.
      this.logger.warn(
        JSON.stringify({ event: 'revoke_failed', connectionId, message: (error as Error).message }),
      );
    }

    await this.prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        encryptedAccessToken: '',
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
      },
    });
  }

  /** Versão pública (HTTP): NUNCA inclui o page access token na resposta. */
  async listProviderPages(
    userId: string,
    connectionId: string,
  ): Promise<Array<Omit<ProviderPage, 'pageAccessToken'>>> {
    const pages = await this.fetchProviderPages(userId, connectionId);
    return pages.map(({ pageId, pageName, pageAvatarUrl }) => ({
      pageId,
      pageName,
      pageAvatarUrl,
    }));
  }

  async connectPage(userId: string, connectionId: string, pageId: string) {
    const connection = await this.requireOwned(userId, connectionId);
    const pages = await this.fetchProviderPages(userId, connectionId);
    const page = pages.find((p) => p.pageId === pageId);
    if (!page) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Página não encontrada nesta conta.', 404);
    }

    // O page token é cifrado em repouso e usado apenas pelo worker na publicação.
    const encryptedPageAccessToken = page.pageAccessToken
      ? this.cipher.encrypt(page.pageAccessToken)
      : null;

    const saved = await this.prisma.facebookPageConnection.upsert({
      where: { socialConnectionId_pageId: { socialConnectionId: connection.id, pageId } },
      create: {
        socialConnectionId: connection.id,
        pageId: page.pageId,
        pageName: page.pageName,
        pageAvatarUrl: page.pageAvatarUrl ?? null,
        encryptedPageAccessToken,
        status: 'ACTIVE',
      },
      update: {
        pageName: page.pageName,
        pageAvatarUrl: page.pageAvatarUrl ?? null,
        encryptedPageAccessToken,
        status: 'ACTIVE',
      },
    });
    // Nunca devolver o token (nem cifrado) na resposta HTTP.
    const { encryptedPageAccessToken: _omitted, ...safe } = saved;
    return safe;
  }

  private async fetchProviderPages(userId: string, connectionId: string): Promise<ProviderPage[]> {
    const connection = await this.requireOwned(userId, connectionId);
    const connector = this.registry.get(connection.provider as SocialProvider);
    if (!connector.listPages) {
      throw new AppError(
        ErrorCode.ACCOUNT_NOT_SUPPORTED,
        'Este provedor não possui Páginas para listar.',
        400,
      );
    }
    const pages = await connector.listPages(this.toConnectorConnection(connection));
    if (pages.length === 0) {
      throw new AppError(
        ErrorCode.ACCOUNT_NOT_SUPPORTED,
        'Nenhuma Página administrada foi encontrada nesta conta do Facebook.',
        404,
      );
    }
    return pages;
  }

  async disconnectPage(userId: string, pageConnectionId: string): Promise<void> {
    const page = await this.prisma.facebookPageConnection.findUnique({
      where: { id: pageConnectionId },
      include: { socialConnection: true },
    });
    if (!page || page.socialConnection.userId !== userId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Página conectada não encontrada.', 404);
    }
    await this.prisma.facebookPageConnection.delete({ where: { id: pageConnectionId } });
  }

  private callbackUri(provider: SocialProvider): string {
    const apiUrl = this.config.getOrThrow<string>('API_URL');
    return `${apiUrl}/api/v1/social-connections/${provider}/callback`;
  }

  private async requireOwned(userId: string, connectionId: string) {
    const connection = await this.prisma.socialConnection.findUnique({
      where: { id: connectionId },
    });
    // Mesma resposta para "não existe" e "não é seu" — sem oráculo de IDs (IDOR).
    if (!connection || connection.userId !== userId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Conexão não encontrada.', 404);
    }
    return connection;
  }

  private toConnectorConnection(connection: SocialConnection): ConnectorConnection {
    return {
      id: connection.id,
      userId: connection.userId,
      provider: connection.provider as SocialProvider,
      externalAccountId: connection.externalAccountId,
      accountType: connection.accountType ?? undefined,
      status: connection.status as ConnectorConnection['status'],
      // Descriptografado apenas no momento da chamada ao conector; nunca logado.
      accessToken: connection.encryptedAccessToken
        ? this.cipher.decrypt(connection.encryptedAccessToken)
        : undefined,
      refreshToken: connection.encryptedRefreshToken
        ? this.cipher.decrypt(connection.encryptedRefreshToken)
        : undefined,
    };
  }
}
