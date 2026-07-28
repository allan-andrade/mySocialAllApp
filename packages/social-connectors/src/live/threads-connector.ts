import { AppError, ErrorCode, type SocialProvider } from '@social-publisher/shared';

import { getProviderPolicy } from '../policies';
import type {
  AuthorizationCodeInput,
  AuthorizationInput,
  ProviderCapabilities,
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

import { providerFetch, sleep, type LiveConnectorOptions } from './http';

const AUTHORIZE_URL = 'https://threads.net/oauth/authorize';
const GRAPH_BASE = 'https://graph.threads.net';
const API_VERSION = 'v1.0';
const LABEL = 'Threads';
const SCOPES = ['threads_basic', 'threads_content_publish'];

interface ThreadsTokenResponse {
  access_token: string;
  user_id?: string;
  expires_in?: number;
}

interface ThreadsContainerStatus {
  status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
  error_message?: string;
}

export interface ThreadsCredentials {
  appId: string;
  appSecret: string;
}

/**
 * Conector real da Threads API (Meta). Fluxo oficial de publicação:
 * criar container → aguardar processamento → threads_publish → permalink.
 * Criar o container NÃO é publicar (seção 2 do briefing).
 */
export class ThreadsConnector implements SocialConnector {
  readonly provider: SocialProvider = 'threads';

  private readonly pollIntervalMs: number;
  private readonly pollLimit: number;

  constructor(
    private readonly credentials: ThreadsCredentials,
    options: LiveConnectorOptions = {},
  ) {
    this.pollIntervalMs = options.statusPollIntervalMs ?? 2000;
    this.pollLimit = options.statusPollLimit ?? 30;
  }

  async getAuthorizationUrl(input: AuthorizationInput): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.credentials.appId,
      redirect_uri: input.redirectUri,
      scope: SCOPES.join(','),
      response_type: 'code',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeAuthorizationCode(input: AuthorizationCodeInput): Promise<SocialTokenResult> {
    // 1) código → token de curta duração
    const shortLived = await providerFetch<ThreadsTokenResponse>(
      LABEL,
      `${GRAPH_BASE}/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.credentials.appId,
          client_secret: this.credentials.appSecret,
          grant_type: 'authorization_code',
          redirect_uri: input.redirectUri,
          code: input.code,
        }),
      },
    );

    // 2) curta duração → longa duração (~60 dias)
    const longLivedParams = new URLSearchParams({
      grant_type: 'th_exchange_token',
      client_secret: this.credentials.appSecret,
      access_token: shortLived.access_token,
    });
    const longLived = await providerFetch<ThreadsTokenResponse>(
      LABEL,
      `${GRAPH_BASE}/access_token?${longLivedParams.toString()}`,
    );

    return {
      accessToken: longLived.access_token,
      // Threads renova o próprio long-lived token; não há refresh token separado.
      refreshToken: undefined,
      expiresAt: longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000)
        : undefined,
      scopes: SCOPES,
    };
  }

  async refreshAccessToken(connection: SocialConnection): Promise<SocialTokenResult> {
    const params = new URLSearchParams({
      grant_type: 'th_refresh_token',
      access_token: this.requireToken(connection),
    });
    const refreshed = await providerFetch<ThreadsTokenResponse>(
      LABEL,
      `${GRAPH_BASE}/refresh_access_token?${params.toString()}`,
    );
    return {
      accessToken: refreshed.access_token,
      expiresAt: refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000)
        : undefined,
      scopes: SCOPES,
    };
  }

  async revokeConnection(_connection: SocialConnection): Promise<void> {
    // A Threads API não expõe endpoint de revogação; a remoção local dos tokens
    // (feita pelo chamador) encerra o acesso do nosso lado.
  }

  async getProfile(connection: SocialConnection): Promise<SocialProfile> {
    const me = await providerFetch<{
      id: string;
      username: string;
      name?: string;
      threads_profile_picture_url?: string;
    }>(LABEL, `${GRAPH_BASE}/${API_VERSION}/me?fields=id,username,name,threads_profile_picture_url`, {
      headers: this.authHeaders(connection),
    });
    return {
      externalAccountId: me.id,
      username: me.username,
      displayName: me.name ?? me.username,
      avatarUrl: me.threads_profile_picture_url,
      accountType: 'standard',
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
      { text: input.text, media: input.media.map((m) => ({ mimeType: m.mimeType })) },
      getProviderPolicy(this.provider),
    );
  }

  async publish(
    input: ProviderPostInput,
    connection: SocialConnection,
  ): Promise<ProviderPublishResult> {
    const userId = connection.externalAccountId;
    const containerId = await this.createContainer(input, connection);

    // Vídeos e carrosséis processam de forma assíncrona; aguardar FINISHED.
    if (input.media.length > 0) {
      await this.waitContainerReady(containerId, connection);
    }

    const published = await providerFetch<{ id: string }>(
      LABEL,
      `${GRAPH_BASE}/${API_VERSION}/${userId}/threads_publish`,
      {
        method: 'POST',
        headers: {
          ...this.authHeaders(connection),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ creation_id: containerId }),
      },
    );

    return {
      externalPublicationId: published.id,
      externalUrl: await this.fetchPermalink(published.id, connection),
    };
  }

  async getPublishStatus(
    externalPublicationId: string,
    connection: SocialConnection,
  ): Promise<ProviderPublishStatus> {
    const permalink = await this.fetchPermalink(externalPublicationId, connection);
    return { status: 'published', externalUrl: permalink };
  }

  private async createContainer(
    input: ProviderPostInput,
    connection: SocialConnection,
  ): Promise<string> {
    const userId = connection.externalAccountId;
    const endpoint = `${GRAPH_BASE}/${API_VERSION}/${userId}/threads`;
    const headers = {
      ...this.authHeaders(connection),
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    const createOne = async (params: URLSearchParams): Promise<string> => {
      const result = await providerFetch<{ id: string }>(LABEL, endpoint, {
        method: 'POST',
        headers,
        body: params,
      });
      return result.id;
    };

    if (input.media.length === 0) {
      return createOne(new URLSearchParams({ media_type: 'TEXT', text: input.text }));
    }

    if (input.media.length === 1) {
      const item = input.media[0]!;
      const isVideo = item.mimeType.startsWith('video/');
      const params = new URLSearchParams({
        media_type: isVideo ? 'VIDEO' : 'IMAGE',
        [isVideo ? 'video_url' : 'image_url']: item.url,
      });
      if (input.text) params.set('text', input.text);
      if (item.altText) params.set('alt_text', item.altText);
      return createOne(params);
    }

    // Carrossel: um container por item + container agregador.
    const childIds: string[] = [];
    for (const item of input.media) {
      const isVideo = item.mimeType.startsWith('video/');
      const params = new URLSearchParams({
        media_type: isVideo ? 'VIDEO' : 'IMAGE',
        [isVideo ? 'video_url' : 'image_url']: item.url,
        is_carousel_item: 'true',
      });
      if (item.altText) params.set('alt_text', item.altText);
      childIds.push(await createOne(params));
    }
    const carousel = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: childIds.join(','),
    });
    if (input.text) carousel.set('text', input.text);
    return createOne(carousel);
  }

  private async waitContainerReady(
    containerId: string,
    connection: SocialConnection,
  ): Promise<void> {
    for (let attempt = 0; attempt < this.pollLimit; attempt++) {
      const status = await providerFetch<ThreadsContainerStatus>(
        LABEL,
        `${GRAPH_BASE}/${API_VERSION}/${containerId}?fields=status,error_message`,
        { headers: this.authHeaders(connection) },
      );
      if (status.status === 'FINISHED' || status.status === 'PUBLISHED') return;
      if (status.status === 'ERROR' || status.status === 'EXPIRED') {
        throw new AppError(
          ErrorCode.MEDIA_PROCESSING_FAILED,
          `O Threads falhou ao processar a mídia${status.error_message ? `: ${status.error_message}` : '.'}`,
          422,
          false,
        );
      }
      await sleep(this.pollIntervalMs);
    }
    throw new AppError(
      ErrorCode.MEDIA_PROCESSING_FAILED,
      'O Threads ainda está processando a mídia. Nova tentativa em instantes.',
      503,
      true,
    );
  }

  private async fetchPermalink(
    mediaId: string,
    connection: SocialConnection,
  ): Promise<string | undefined> {
    try {
      const media = await providerFetch<{ permalink?: string }>(
        LABEL,
        `${GRAPH_BASE}/${API_VERSION}/${mediaId}?fields=permalink`,
        { headers: this.authHeaders(connection) },
      );
      return media.permalink;
    } catch {
      return undefined; // permalink é cosmético; não falha a publicação
    }
  }

  private authHeaders(connection: SocialConnection): Record<string, string> {
    return { Authorization: `Bearer ${this.requireToken(connection)}` };
  }

  private requireToken(connection: SocialConnection): string {
    if (!connection.accessToken) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Conexão do Threads sem token de acesso. Reconecte a conta.',
        401,
        false,
      );
    }
    return connection.accessToken;
  }
}
