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
import {
  META_AUTHORIZE_URL,
  META_GRAPH_BASE,
  metaExchangeCodeForLongLivedToken,
  metaExchangeForLongLived,
  type MetaCredentials,
} from './meta-oauth';

const GRAPH_BASE = META_GRAPH_BASE;
const AUTHORIZE_URL = META_AUTHORIZE_URL;
const LABEL = 'Instagram';
const SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list'];

interface InstagramAccount {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
}

export type { MetaCredentials } from './meta-oauth';

/**
 * Conector real do Instagram (Graph API). Publicação exige conta profissional
 * (criador/empresa) vinculada a uma Página. Fluxo: container em /{ig-id}/media →
 * polling de status_code → /{ig-id}/media_publish. Container criado ≠ publicado.
 */
export class InstagramConnector implements SocialConnector {
  readonly provider: SocialProvider = 'instagram';

  private readonly pollIntervalMs: number;
  private readonly pollLimit: number;

  constructor(
    private readonly credentials: MetaCredentials,
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
    return metaExchangeCodeForLongLivedToken(
      LABEL,
      this.credentials,
      input.redirectUri,
      input.code,
      SCOPES,
    );
  }

  async refreshAccessToken(connection: SocialConnection): Promise<SocialTokenResult> {
    return metaExchangeForLongLived(LABEL, this.credentials, this.requireToken(connection), SCOPES);
  }

  async revokeConnection(connection: SocialConnection): Promise<void> {
    if (!connection.accessToken) return;
    await providerFetch(LABEL, `${GRAPH_BASE}/me/permissions`, {
      method: 'DELETE',
      headers: this.authHeaders(connection),
      expectJson: false,
    });
  }

  async getProfile(connection: SocialConnection): Promise<SocialProfile> {
    const account = await this.findInstagramAccount(connection);
    return {
      externalAccountId: account.id,
      username: account.username,
      displayName: account.name ?? account.username,
      avatarUrl: account.profile_picture_url,
      // Se chegou aqui via /me/accounts, é conta profissional vinculada a Página.
      accountType: 'business',
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
    if (input.media.length === 0) {
      // A política já bloqueia isso antes; defesa em profundidade no conector.
      throw new AppError(
        ErrorCode.MEDIA_REQUIRED,
        'O Instagram exige pelo menos uma imagem ou vídeo.',
        422,
        false,
      );
    }

    const igUserId = connection.externalAccountId;
    const containerId = await this.createContainer(input, connection);
    await this.waitContainerReady(containerId, connection);

    const published = await providerFetch<{ id: string }>(
      LABEL,
      `${GRAPH_BASE}/${igUserId}/media_publish`,
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

  private async findInstagramAccount(connection: SocialConnection): Promise<InstagramAccount> {
    const accounts = await providerFetch<{
      data: Array<{ instagram_business_account?: InstagramAccount }>;
    }>(
      LABEL,
      `${GRAPH_BASE}/me/accounts?fields=instagram_business_account{id,username,name,profile_picture_url}`,
      { headers: this.authHeaders(connection) },
    );
    const account = accounts.data.find((page) => page.instagram_business_account)
      ?.instagram_business_account;
    if (!account) {
      throw new AppError(
        ErrorCode.ACCOUNT_NOT_SUPPORTED,
        'Nenhuma conta profissional do Instagram (criador/empresa) vinculada a uma Página foi encontrada. Contas pessoais não são suportadas pela API.',
        400,
        false,
      );
    }
    return account;
  }

  private async createContainer(
    input: ProviderPostInput,
    connection: SocialConnection,
  ): Promise<string> {
    const igUserId = connection.externalAccountId;
    const endpoint = `${GRAPH_BASE}/${igUserId}/media`;
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

    if (input.media.length === 1) {
      // 1 mídia = publicação única (imagem) ou Reel (vídeo de feed).
      const item = input.media[0]!;
      const isVideo = item.mimeType.startsWith('video/');
      const params = isVideo
        ? new URLSearchParams({ media_type: 'REELS', video_url: item.url })
        : new URLSearchParams({ image_url: item.url });
      if (input.text) params.set('caption', input.text);
      return createOne(params);
    }

    // 2+ mídias = carrossel (imagens e vídeos podem se misturar).
    const childIds: string[] = [];
    for (const item of input.media) {
      const isVideo = item.mimeType.startsWith('video/');
      const params = isVideo
        ? new URLSearchParams({ media_type: 'VIDEO', video_url: item.url, is_carousel_item: 'true' })
        : new URLSearchParams({ image_url: item.url, is_carousel_item: 'true' });
      childIds.push(await createOne(params));
    }
    const carousel = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: childIds.join(','),
    });
    if (input.text) carousel.set('caption', input.text);
    return createOne(carousel);
  }

  private async waitContainerReady(
    containerId: string,
    connection: SocialConnection,
  ): Promise<void> {
    for (let attempt = 0; attempt < this.pollLimit; attempt++) {
      const container = await providerFetch<{ status_code?: string }>(
        LABEL,
        `${GRAPH_BASE}/${containerId}?fields=status_code`,
        { headers: this.authHeaders(connection) },
      );
      const status = container.status_code ?? 'IN_PROGRESS';
      if (status === 'FINISHED' || status === 'PUBLISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new AppError(
          ErrorCode.MEDIA_PROCESSING_FAILED,
          'O Instagram falhou ao processar a mídia do container.',
          422,
          false,
        );
      }
      await sleep(this.pollIntervalMs);
    }
    throw new AppError(
      ErrorCode.MEDIA_PROCESSING_FAILED,
      'O Instagram ainda está processando a mídia. Nova tentativa em instantes.',
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
        `${GRAPH_BASE}/${mediaId}?fields=permalink`,
        { headers: this.authHeaders(connection) },
      );
      return media.permalink;
    } catch {
      return undefined;
    }
  }

  private authHeaders(connection: SocialConnection): Record<string, string> {
    return { Authorization: `Bearer ${this.requireToken(connection)}` };
  }

  private requireToken(connection: SocialConnection): string {
    if (!connection.accessToken) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Conexão do Instagram sem token de acesso. Reconecte a conta.',
        401,
        false,
      );
    }
    return connection.accessToken;
  }
}
