import { AppError, ErrorCode, type SocialProvider } from '@social-publisher/shared';

import { getProviderPolicy } from '../policies';
import type {
  AuthorizationCodeInput,
  AuthorizationInput,
  ProviderCapabilities,
  ProviderPostInput,
  ProviderPostMediaInput,
  ProviderPublishResult,
  ProviderValidationResult,
  SocialConnection,
  SocialConnector,
  SocialProfile,
  SocialTokenResult,
} from '../types';
import { validatePostAgainstPolicy } from '../validate';

import { providerFetch, sleep, type LiveConnectorOptions } from './http';

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const API_BASE = 'https://api.x.com/2';
const LABEL = 'X';
// Somente os scopes necessários: ler usuário, publicar e renovar token.
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface XMediaUploadResponse {
  data?: { id?: string; processing_info?: { state: string; check_after_secs?: number } };
  media_id_string?: string;
  processing_info?: { state: string; check_after_secs?: number };
}

export interface XCredentials {
  clientId: string;
  /** Presente para clientes confidenciais (Basic auth no endpoint de token). */
  clientSecret?: string;
}

/**
 * Conector real do X (API v2): OAuth 2.0 Authorization Code + PKCE, upload de
 * mídia em chunks (INIT/APPEND/FINALIZE) ANTES da criação do post, e publicação
 * via POST /2/tweets. Posts longos de contas Premium NÃO são habilitados
 * automaticamente — o limite vem da política central (280 ponderado).
 */
export class XConnector implements SocialConnector {
  readonly provider: SocialProvider = 'x';

  private readonly pollIntervalMs: number;
  private readonly pollLimit: number;

  constructor(
    private readonly credentials: XCredentials,
    options: LiveConnectorOptions = {},
  ) {
    this.pollIntervalMs = options.statusPollIntervalMs ?? 2000;
    this.pollLimit = options.statusPollLimit ?? 30;
  }

  async getAuthorizationUrl(input: AuthorizationInput): Promise<string> {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.credentials.clientId,
      redirect_uri: input.redirectUri,
      scope: SCOPES.join(' '),
    });
    // state e code_challenge (S256) são anexados pelo backend, que guarda o verifier.
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeAuthorizationCode(input: AuthorizationCodeInput): Promise<SocialTokenResult> {
    if (!input.codeVerifier) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Fluxo do X exige PKCE: code_verifier ausente.',
        400,
        false,
      );
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_id: this.credentials.clientId,
    });
    const token = await this.tokenRequest(body);
    return this.toTokenResult(token);
  }

  async refreshAccessToken(connection: SocialConnection): Promise<SocialTokenResult> {
    if (!connection.refreshToken) {
      throw new AppError(
        ErrorCode.TOKEN_EXPIRED,
        'Conexão do X sem refresh token. Reconecte a conta.',
        401,
        false,
      );
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
      client_id: this.credentials.clientId,
    });
    const token = await this.tokenRequest(body);
    return this.toTokenResult(token);
  }

  async revokeConnection(connection: SocialConnection): Promise<void> {
    if (!connection.accessToken) return;
    await providerFetch(LABEL, `${API_BASE}/oauth2/revoke`, {
      method: 'POST',
      headers: {
        ...this.basicAuthHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: connection.accessToken,
        token_type_hint: 'access_token',
        client_id: this.credentials.clientId,
      }),
      expectJson: false,
    });
  }

  async getProfile(connection: SocialConnection): Promise<SocialProfile> {
    const me = await providerFetch<{
      data: { id: string; username: string; name: string; profile_image_url?: string };
    }>(LABEL, `${API_BASE}/users/me?user.fields=profile_image_url`, {
      headers: this.bearerHeaders(connection),
    });
    return {
      externalAccountId: me.data.id,
      username: me.data.username,
      displayName: me.data.name,
      avatarUrl: me.data.profile_image_url,
      // Arquitetura pronta para detectar capacidades (Premium) no futuro;
      // por ora toda conta é tratada como padrão (280 ponderado).
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
    // Upload de TODA a mídia antes de criar o post (exigência da API do X).
    const mediaIds: string[] = [];
    for (const item of input.media) {
      mediaIds.push(await this.uploadMedia(item, connection));
    }

    const payload: { text: string; media?: { media_ids: string[] } } = { text: input.text };
    if (mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds };
    }

    const tweet = await providerFetch<{ data: { id: string } }>(LABEL, `${API_BASE}/tweets`, {
      method: 'POST',
      headers: { ...this.bearerHeaders(connection), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return {
      externalPublicationId: tweet.data.id,
      // URL canônica que redireciona sem depender do username.
      externalUrl: `https://x.com/i/web/status/${tweet.data.id}`,
    };
  }

  private async uploadMedia(
    item: ProviderPostMediaInput,
    connection: SocialConnection,
  ): Promise<string> {
    const bytes = await this.downloadMedia(item.url);
    const isVideo = item.mimeType.startsWith('video/');
    const isGif = item.mimeType === 'image/gif';
    const category = isVideo ? 'tweet_video' : isGif ? 'tweet_gif' : 'tweet_image';
    const uploadUrl = `${API_BASE}/media/upload`;
    const headers = this.bearerHeaders(connection);

    // INIT
    const initForm = new FormData();
    initForm.set('command', 'INIT');
    initForm.set('total_bytes', String(bytes.byteLength));
    initForm.set('media_type', item.mimeType);
    initForm.set('media_category', category);
    const initResponse = await providerFetch<XMediaUploadResponse>(LABEL, uploadUrl, {
      method: 'POST',
      headers,
      body: initForm,
    });
    const mediaId = initResponse.data?.id ?? initResponse.media_id_string;
    if (!mediaId) {
      throw new AppError(
        ErrorCode.MEDIA_PROCESSING_FAILED,
        'O X não devolveu o identificador da mídia no INIT do upload.',
        502,
        true,
      );
    }

    // APPEND em chunks
    for (let offset = 0, segment = 0; offset < bytes.byteLength; offset += UPLOAD_CHUNK_BYTES, segment++) {
      const chunk = bytes.subarray(offset, Math.min(offset + UPLOAD_CHUNK_BYTES, bytes.byteLength));
      const appendForm = new FormData();
      appendForm.set('command', 'APPEND');
      appendForm.set('media_id', mediaId);
      appendForm.set('segment_index', String(segment));
      appendForm.set('media', new Blob([chunk], { type: item.mimeType }));
      await providerFetch(LABEL, uploadUrl, {
        method: 'POST',
        headers,
        body: appendForm,
        expectJson: false,
      });
    }

    // FINALIZE
    const finalizeForm = new FormData();
    finalizeForm.set('command', 'FINALIZE');
    finalizeForm.set('media_id', mediaId);
    const finalized = await providerFetch<XMediaUploadResponse>(LABEL, uploadUrl, {
      method: 'POST',
      headers,
      body: finalizeForm,
    });

    // Vídeos processam de forma assíncrona: aguardar processing_info.
    let processing = finalized.data?.processing_info ?? finalized.processing_info;
    for (let attempt = 0; processing && processing.state !== 'succeeded'; attempt++) {
      if (processing.state === 'failed') {
        throw new AppError(
          ErrorCode.MEDIA_PROCESSING_FAILED,
          'O X falhou ao processar a mídia enviada.',
          422,
          false,
        );
      }
      if (attempt >= this.pollLimit) {
        throw new AppError(
          ErrorCode.MEDIA_PROCESSING_FAILED,
          'O X ainda está processando a mídia. Nova tentativa em instantes.',
          503,
          true,
        );
      }
      await sleep(processing.check_after_secs ? processing.check_after_secs * 1000 : this.pollIntervalMs);
      const status = await providerFetch<XMediaUploadResponse>(
        LABEL,
        `${uploadUrl}?command=STATUS&media_id=${mediaId}`,
        { headers },
      );
      processing = status.data?.processing_info ?? status.processing_info;
    }

    // Texto alternativo (acessibilidade) — melhor esforço, não bloqueia o post.
    if (item.altText) {
      try {
        await providerFetch(LABEL, `${API_BASE}/media/metadata`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: item.altText } } }),
          expectJson: false,
        });
      } catch {
        // alt text é opcional na API; falha aqui não deve derrubar a publicação
      }
    }

    return mediaId;
  }

  private async downloadMedia(url: string): Promise<Uint8Array> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new AppError(
        ErrorCode.MEDIA_PROCESSING_FAILED,
        `Não foi possível ler a mídia do armazenamento para envio ao X (${error instanceof Error ? error.message : 'erro'}).`,
        503,
        true,
      );
    }
  }

  private async tokenRequest(body: URLSearchParams): Promise<XTokenResponse> {
    return providerFetch<XTokenResponse>(LABEL, `${API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: {
        ...this.basicAuthHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  }

  private toTokenResult(token: XTokenResponse): SocialTokenResult {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
      scopes: token.scope ? token.scope.split(' ') : SCOPES,
    };
  }

  private basicAuthHeaders(): Record<string, string> {
    if (!this.credentials.clientSecret) return {};
    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  private bearerHeaders(connection: SocialConnection): Record<string, string> {
    if (!connection.accessToken) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_REQUIRED,
        'Conexão do X sem token de acesso. Reconecte a conta.',
        401,
        false,
      );
    }
    return { Authorization: `Bearer ${connection.accessToken}` };
  }
}
