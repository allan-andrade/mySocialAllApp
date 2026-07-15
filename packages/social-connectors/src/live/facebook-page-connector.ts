import { AppError, ErrorCode, type SocialProvider } from '@social-publisher/shared';

import { getProviderPolicy } from '../policies';
import type {
  AuthorizationCodeInput,
  AuthorizationInput,
  ProviderCapabilities,
  ProviderPage,
  ProviderPostInput,
  ProviderPublishResult,
  ProviderValidationResult,
  SocialConnection,
  SocialConnector,
  SocialProfile,
  SocialTokenResult,
} from '../types';
import { validatePostAgainstPolicy } from '../validate';

import { providerFetch } from './http';
import {
  META_AUTHORIZE_URL,
  META_GRAPH_BASE,
  metaExchangeCodeForLongLivedToken,
  metaExchangeForLongLived,
  type MetaCredentials,
} from './meta-oauth';

const LABEL = 'Facebook';
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];

/**
 * Conector real de Páginas do Facebook. A identidade da conexão é o usuário do
 * Facebook; a publicação acontece em Páginas administradas (destinos filhos),
 * cada uma com o próprio page access token. Perfis pessoais não são suportados.
 */
export class FacebookPageConnector implements SocialConnector {
  readonly provider: SocialProvider = 'facebook_page';

  constructor(private readonly credentials: MetaCredentials) {}

  async getAuthorizationUrl(input: AuthorizationInput): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.credentials.appId,
      redirect_uri: input.redirectUri,
      scope: SCOPES.join(','),
      response_type: 'code',
    });
    return `${META_AUTHORIZE_URL}?${params.toString()}`;
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
    await providerFetch(LABEL, `${META_GRAPH_BASE}/me/permissions`, {
      method: 'DELETE',
      headers: this.authHeaders(connection.accessToken),
      expectJson: false,
    });
  }

  async getProfile(connection: SocialConnection): Promise<SocialProfile> {
    const me = await providerFetch<{
      id: string;
      name: string;
      picture?: { data?: { url?: string } };
    }>(LABEL, `${META_GRAPH_BASE}/me?fields=id,name,picture{url}`, {
      headers: this.authHeaders(this.requireToken(connection)),
    });
    return {
      externalAccountId: me.id,
      username: me.name,
      displayName: me.name,
      avatarUrl: me.picture?.data?.url,
      accountType: 'standard',
    };
  }

  async listPages(connection: SocialConnection): Promise<ProviderPage[]> {
    const accounts = await providerFetch<{
      data: Array<{
        id: string;
        name: string;
        access_token?: string;
        picture?: { data?: { url?: string } };
      }>;
    }>(
      LABEL,
      `${META_GRAPH_BASE}/me/accounts?fields=id,name,access_token,picture{url}`,
      { headers: this.authHeaders(this.requireToken(connection)) },
    );
    return accounts.data.map((page) => ({
      pageId: page.id,
      pageName: page.name,
      pageAvatarUrl: page.picture?.data?.url,
      pageAccessToken: page.access_token,
    }));
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
    const page = connection.page;
    if (!page?.pageId || !page.accessToken) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Nenhuma Página do Facebook com token válido para publicar. Reconecte e selecione a Página.',
        401,
        false,
      );
    }

    const headers = {
      ...this.authHeaders(page.accessToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const images = input.media.filter((m) => m.mimeType.startsWith('image/'));
    const videos = input.media.filter((m) => m.mimeType.startsWith('video/'));

    let postId: string;

    if (videos.length === 1 && images.length === 0) {
      const params = new URLSearchParams({ file_url: videos[0]!.url });
      if (input.text) params.set('description', input.text);
      const result = await providerFetch<{ id: string }>(
        LABEL,
        `${META_GRAPH_BASE}/${page.pageId}/videos`,
        { method: 'POST', headers, body: params },
      );
      postId = result.id;
    } else if (images.length === 1 && videos.length === 0) {
      const params = new URLSearchParams({ url: images[0]!.url });
      if (input.text) params.set('caption', input.text);
      const result = await providerFetch<{ id: string; post_id?: string }>(
        LABEL,
        `${META_GRAPH_BASE}/${page.pageId}/photos`,
        { method: 'POST', headers, body: params },
      );
      postId = result.post_id ?? result.id;
    } else if (images.length > 1 && videos.length === 0) {
      // Multi-foto: sobe cada foto sem publicar e anexa todas a um único post.
      const mediaIds: string[] = [];
      for (const image of images) {
        const params = new URLSearchParams({ url: image.url, published: 'false' });
        const uploaded = await providerFetch<{ id: string }>(
          LABEL,
          `${META_GRAPH_BASE}/${page.pageId}/photos`,
          { method: 'POST', headers, body: params },
        );
        mediaIds.push(uploaded.id);
      }
      const feedParams = new URLSearchParams();
      if (input.text) feedParams.set('message', input.text);
      mediaIds.forEach((id, index) => {
        feedParams.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id }));
      });
      const result = await providerFetch<{ id: string }>(
        LABEL,
        `${META_GRAPH_BASE}/${page.pageId}/feed`,
        { method: 'POST', headers, body: feedParams },
      );
      postId = result.id;
    } else if (input.media.length === 0) {
      const result = await providerFetch<{ id: string }>(
        LABEL,
        `${META_GRAPH_BASE}/${page.pageId}/feed`,
        { method: 'POST', headers, body: new URLSearchParams({ message: input.text }) },
      );
      postId = result.id;
    } else {
      // Mistura imagem+vídeo ou múltiplos vídeos: a Graph API não suporta num
      // único post de Página — a política central já bloqueia antes de chegar aqui.
      throw new AppError(
        ErrorCode.MEDIA_NOT_SUPPORTED,
        'O Facebook não permite combinar vídeos com fotos (ou múltiplos vídeos) em um único post de Página.',
        422,
        false,
      );
    }

    return {
      externalPublicationId: postId,
      externalUrl: `https://www.facebook.com/${postId}`,
    };
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  private requireToken(connection: SocialConnection): string {
    if (!connection.accessToken) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Conexão do Facebook sem token de acesso. Reconecte a conta.',
        401,
        false,
      );
    }
    return connection.accessToken;
  }
}
