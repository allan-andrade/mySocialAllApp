import { ErrorCode } from '@social-publisher/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { SocialConnection } from '../types';

import { FacebookPageConnector } from './facebook-page-connector';
import { normalizeProviderHttpError, redactSecrets } from './http';
import { InstagramConnector } from './instagram-connector';
import { ThreadsConnector } from './threads-connector';
import { XConnector } from './x-connector';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function connection(provider: SocialConnection['provider'], extra: Partial<SocialConnection> = {}): SocialConnection {
  return {
    id: 'conn-1',
    userId: 'user-1',
    provider,
    externalAccountId: 'account-1',
    status: 'CONNECTED',
    accessToken: 'user-access-token',
    ...extra,
  };
}

function callUrl(index: number): string {
  return String(fetchMock.mock.calls[index]![0]);
}

function callBody(index: number): unknown {
  return (fetchMock.mock.calls[index]![1] as RequestInit | undefined)?.body;
}

function callHeaders(index: number): Record<string, string> {
  return ((fetchMock.mock.calls[index]![1] as RequestInit | undefined)?.headers ?? {}) as Record<
    string,
    string
  >;
}

// ── Helper HTTP ────────────────────────────────────────────────────────────

describe('redactSecrets / normalizeProviderHttpError', () => {
  it('remove tokens e segredos de mensagens de erro', () => {
    const dirty =
      'call https://graph.threads.net/access_token?client_secret=abc123&access_token=xyz789 with Bearer sk-supersecret';
    const clean = redactSecrets(dirty);
    expect(clean).not.toContain('abc123');
    expect(clean).not.toContain('xyz789');
    expect(clean).not.toContain('sk-supersecret');
    expect(clean).toContain('client_secret=[REDACTED]');
  });

  it('classifica status HTTP em códigos internos e retryability corretos', () => {
    expect(normalizeProviderHttpError('X', 429, {})).toMatchObject({
      code: ErrorCode.RATE_LIMITED,
      retryable: true,
    });
    expect(normalizeProviderHttpError('X', 503, {})).toMatchObject({
      code: ErrorCode.PROVIDER_UNAVAILABLE,
      retryable: true,
    });
    expect(normalizeProviderHttpError('X', 401, {})).toMatchObject({
      code: ErrorCode.TOKEN_EXPIRED,
      retryable: false,
    });
    expect(normalizeProviderHttpError('X', 403, {})).toMatchObject({
      code: ErrorCode.INSUFFICIENT_PERMISSION,
      retryable: false,
    });
    expect(normalizeProviderHttpError('X', 400, { error: { message: 'bad' } })).toMatchObject({
      code: ErrorCode.PROVIDER_REJECTED_CONTENT,
      retryable: false,
    });
  });

  it('mensagem do provedor com token embutido chega redigida', () => {
    const error = normalizeProviderHttpError('Threads', 400, {
      error: { message: 'invalid access_token=secret-token-value here' },
    });
    expect(error.message).not.toContain('secret-token-value');
  });
});

// ── Threads ────────────────────────────────────────────────────────────────

describe('ThreadsConnector', () => {
  const connector = new ThreadsConnector(
    { appId: 'threads-app', appSecret: 'threads-secret' },
    { statusPollIntervalMs: 1, statusPollLimit: 5 },
  );

  it('monta a URL de autorização com client_id, redirect e scopes', async () => {
    const url = await connector.getAuthorizationUrl({
      userId: 'u1',
      redirectUri: 'https://api.local/cb',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://threads.net/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('threads-app');
    expect(parsed.searchParams.get('scope')).toContain('threads_content_publish');
    expect(parsed.searchParams.get('response_type')).toBe('code');
  });

  it('troca o código por token curto e promove para long-lived', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'short', user_id: '42' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'long', expires_in: 5_184_000 }));

    const tokens = await connector.exchangeAuthorizationCode({
      code: 'auth-code',
      state: 's',
      redirectUri: 'https://api.local/cb',
    });

    expect(callUrl(0)).toBe('https://graph.threads.net/oauth/access_token');
    const exchangeBody = callBody(0) as URLSearchParams;
    expect(exchangeBody.get('code')).toBe('auth-code');
    expect(exchangeBody.get('grant_type')).toBe('authorization_code');

    expect(callUrl(1)).toContain('grant_type=th_exchange_token');
    expect(tokens.accessToken).toBe('long');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it('publica texto: container TEXT → threads_publish → permalink', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'container-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'media-1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.threads.net/@u/post/p1' }));

    const result = await connector.publish({ text: 'olá', media: [] }, connection('threads'));

    expect(callUrl(0)).toBe('https://graph.threads.net/v1.0/account-1/threads');
    expect((callBody(0) as URLSearchParams).get('media_type')).toBe('TEXT');
    expect(callUrl(1)).toBe('https://graph.threads.net/v1.0/account-1/threads_publish');
    expect((callBody(1) as URLSearchParams).get('creation_id')).toBe('container-1');
    expect(result.externalPublicationId).toBe('media-1');
    expect(result.externalUrl).toBe('https://www.threads.net/@u/post/p1');
    // Token vai no header Authorization, nunca na URL.
    expect(callHeaders(0)['Authorization']).toBe('Bearer user-access-token');
    expect(callUrl(0)).not.toContain('access_token');
  });

  it('com mídia, aguarda o container FINISHED antes de publicar', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'c-video' })) // container
      .mockResolvedValueOnce(jsonResponse({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'media-2' })) // publish
      .mockResolvedValueOnce(jsonResponse({ permalink: undefined }));

    const result = await connector.publish(
      {
        text: 'com vídeo',
        media: [{ url: 'https://storage/video.mp4', mimeType: 'video/mp4' }],
      },
      connection('threads'),
    );

    expect((callBody(0) as URLSearchParams).get('media_type')).toBe('VIDEO');
    expect(callUrl(1)).toContain('fields=status');
    expect(result.externalPublicationId).toBe('media-2');
  });

  it('container em ERROR falha de forma definitiva', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'c-bad' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ERROR', error_message: 'formato inválido' }));

    await expect(
      connector.publish(
        { text: '', media: [{ url: 'https://storage/x.jpg', mimeType: 'image/jpeg' }] },
        connection('threads'),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.MEDIA_PROCESSING_FAILED, retryable: false });
  });

  it('429 do provedor vira RATE_LIMITED retryable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limit' } }, 429));
    await expect(
      connector.publish({ text: 'x', media: [] }, connection('threads')),
    ).rejects.toMatchObject({ code: ErrorCode.RATE_LIMITED, retryable: true });
  });
});

// ── Instagram ──────────────────────────────────────────────────────────────

describe('InstagramConnector', () => {
  const connector = new InstagramConnector(
    { appId: 'meta-app', appSecret: 'meta-secret' },
    { statusPollIntervalMs: 1, statusPollLimit: 5 },
  );

  it('resolve a conta profissional via /me/accounts', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {},
          {
            instagram_business_account: {
              id: 'ig-1',
              username: 'minha_marca',
              name: 'Minha Marca',
            },
          },
        ],
      }),
    );

    const profile = await connector.getProfile(connection('instagram'));
    expect(profile.externalAccountId).toBe('ig-1');
    expect(profile.accountType).toBe('business');
  });

  it('sem conta profissional vinculada → ACCOUNT_NOT_SUPPORTED', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{}] }));
    await expect(connector.getProfile(connection('instagram'))).rejects.toMatchObject({
      code: ErrorCode.ACCOUNT_NOT_SUPPORTED,
    });
  });

  it('carrossel: containers filhos → container CAROUSEL → media_publish', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'child-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'child-2' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'carousel-1' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ig-media-1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.instagram.com/p/abc/' }));

    const result = await connector.publish(
      {
        text: 'legenda',
        media: [
          { url: 'https://storage/1.jpg', mimeType: 'image/jpeg' },
          { url: 'https://storage/2.jpg', mimeType: 'image/jpeg' },
        ],
      },
      connection('instagram', { externalAccountId: 'ig-user' }),
    );

    expect((callBody(0) as URLSearchParams).get('is_carousel_item')).toBe('true');
    const carouselParams = callBody(2) as URLSearchParams;
    expect(carouselParams.get('media_type')).toBe('CAROUSEL');
    expect(carouselParams.get('children')).toBe('child-1,child-2');
    expect(carouselParams.get('caption')).toBe('legenda');
    expect(callUrl(4)).toContain('/ig-user/media_publish');
    expect(result.externalUrl).toBe('https://www.instagram.com/p/abc/');
  });

  it('publicação sem mídia é rejeitada no conector (defesa em profundidade)', async () => {
    await expect(
      connector.publish({ text: 'sem mídia', media: [] }, connection('instagram')),
    ).rejects.toMatchObject({ code: ErrorCode.MEDIA_REQUIRED });
  });
});

// ── Facebook Pages ─────────────────────────────────────────────────────────

describe('FacebookPageConnector', () => {
  const connector = new FacebookPageConnector({ appId: 'meta-app', appSecret: 'meta-secret' });
  const fbConnection = connection('facebook_page', {
    page: { pageId: 'page-9', pageName: 'Minha Página', accessToken: 'page-token' },
  });

  it('lista Páginas com os respectivos page tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ id: 'p1', name: 'Página 1', access_token: 'p1-token', picture: { data: { url: 'a.png' } } }],
      }),
    );
    const pages = await connector.listPages!(connection('facebook_page'));
    expect(pages[0]).toMatchObject({ pageId: 'p1', pageName: 'Página 1', pageAccessToken: 'p1-token' });
  });

  it('texto puro publica em /feed com o token da Página (não do usuário)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'page-9_post-1' }));
    const result = await connector.publish({ text: 'novidades!', media: [] }, fbConnection);

    expect(callUrl(0)).toContain('/page-9/feed');
    expect((callBody(0) as URLSearchParams).get('message')).toBe('novidades!');
    expect(callHeaders(0)['Authorization']).toBe('Bearer page-token');
    expect(result.externalUrl).toBe('https://www.facebook.com/page-9_post-1');
  });

  it('multi-foto: sobe cada foto sem publicar e anexa tudo num único post', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'photo-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'photo-2' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'page-9_post-2' }));

    const result = await connector.publish(
      {
        text: 'álbum',
        media: [
          { url: 'https://storage/1.jpg', mimeType: 'image/jpeg' },
          { url: 'https://storage/2.jpg', mimeType: 'image/jpeg' },
        ],
      },
      fbConnection,
    );

    expect((callBody(0) as URLSearchParams).get('published')).toBe('false');
    const feedParams = callBody(2) as URLSearchParams;
    expect(feedParams.get('attached_media[0]')).toBe(JSON.stringify({ media_fbid: 'photo-1' }));
    expect(feedParams.get('attached_media[1]')).toBe(JSON.stringify({ media_fbid: 'photo-2' }));
    expect(result.externalPublicationId).toBe('page-9_post-2');
  });

  it('sem Página selecionada/token → AUTHORIZATION_REQUIRED', async () => {
    await expect(
      connector.publish({ text: 'x', media: [] }, connection('facebook_page')),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_REQUIRED });
  });
});

// ── X ──────────────────────────────────────────────────────────────────────

describe('XConnector', () => {
  const connector = new XConnector(
    { clientId: 'x-client', clientSecret: 'x-secret' },
    { statusPollIntervalMs: 1, statusPollLimit: 5 },
  );

  it('troca o código com code_verifier (PKCE) e Basic auth', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'x-access',
        refresh_token: 'x-refresh',
        expires_in: 7200,
        scope: 'tweet.read tweet.write users.read offline.access',
      }),
    );

    const tokens = await connector.exchangeAuthorizationCode({
      code: 'code-1',
      state: 's',
      redirectUri: 'https://api.local/cb',
      codeVerifier: 'verifier-abc',
    });

    expect(callUrl(0)).toBe('https://api.x.com/2/oauth2/token');
    const body = callBody(0) as URLSearchParams;
    expect(body.get('code_verifier')).toBe('verifier-abc');
    expect(body.get('grant_type')).toBe('authorization_code');
    const expectedBasic = Buffer.from('x-client:x-secret').toString('base64');
    expect(callHeaders(0)['Authorization']).toBe(`Basic ${expectedBasic}`);
    expect(tokens.refreshToken).toBe('x-refresh');
  });

  it('sem code_verifier o fluxo é rejeitado (PKCE obrigatório)', async () => {
    await expect(
      connector.exchangeAuthorizationCode({
        code: 'c',
        state: 's',
        redirectUri: 'https://api.local/cb',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_REQUIRED });
  });

  it('publica texto puro via POST /2/tweets', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: '1234567890' } }));

    const result = await connector.publish({ text: 'olá x', media: [] }, connection('x'));

    expect(callUrl(0)).toBe('https://api.x.com/2/tweets');
    expect(JSON.parse(String(callBody(0)))).toEqual({ text: 'olá x' });
    expect(result.externalUrl).toBe('https://x.com/i/web/status/1234567890');
  });

  it('faz upload da mídia ANTES do post: download → INIT/APPEND/FINALIZE → tweet com media_ids', async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    fetchMock
      .mockResolvedValueOnce(new Response(imageBytes, { status: 200 })) // download da mídia
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'media-77' } })) // INIT
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // APPEND
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'media-77' } })) // FINALIZE
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // metadata alt_text
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'tweet-1' } })); // tweet

    const result = await connector.publish(
      {
        text: 'com foto',
        media: [
          { url: 'https://storage/pic.jpg', mimeType: 'image/jpeg', altText: 'uma foto' },
        ],
      },
      connection('x'),
    );

    expect(callUrl(0)).toBe('https://storage/pic.jpg');
    const initForm = callBody(1) as FormData;
    expect(initForm.get('command')).toBe('INIT');
    expect(initForm.get('media_category')).toBe('tweet_image');
    expect((callBody(2) as FormData).get('command')).toBe('APPEND');
    expect((callBody(3) as FormData).get('command')).toBe('FINALIZE');

    const tweetPayload = JSON.parse(String(callBody(5)));
    expect(tweetPayload.media.media_ids).toEqual(['media-77']);
    expect(result.externalPublicationId).toBe('tweet-1');
  });

  it('refresh sem refresh token falha com TOKEN_EXPIRED', async () => {
    await expect(connector.refreshAccessToken(connection('x'))).rejects.toMatchObject({
      code: ErrorCode.TOKEN_EXPIRED,
    });
  });

  it('refresh com refresh token usa grant_type=refresh_token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 }),
    );
    const tokens = await connector.refreshAccessToken(
      connection('x', { refreshToken: 'old-refresh' }),
    );
    const body = callBody(0) as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(tokens.accessToken).toBe('new-access');
  });
});
