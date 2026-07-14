import { AppError, ErrorCode } from '@social-publisher/shared';
import { describe, expect, it } from 'vitest';

import { createConnectorRegistry } from '../registry';
import type { SocialConnection } from '../types';

import { FakeConnector, MOCK_MARKERS } from './fake-connector';

function mockConnection(provider: SocialConnection['provider']): SocialConnection {
  return {
    id: `conn-${provider}-1`,
    userId: 'user-1',
    provider,
    externalAccountId: `mock-${provider}-account-1`,
    status: 'CONNECTED',
  };
}

describe('FakeConnector — publicação', () => {
  it('publica com sucesso e gera ID/URL claramente identificados como mock', async () => {
    const connector = new FakeConnector('threads');
    const result = await connector.publish(
      { text: 'olá threads', media: [] },
      mockConnection('threads'),
    );

    expect(result.externalPublicationId).toMatch(/^mock-threads-/);
    expect(result.externalUrl).toContain('https://mock.social/threads/');
  });

  it('é determinístico: mesma entrada gera o mesmo ID externo', async () => {
    const connector = new FakeConnector('x');
    const conn = mockConnection('x');
    const a = await connector.publish({ text: 'idempotente', media: [] }, conn);
    const b = await connector.publish({ text: 'idempotente', media: [] }, conn);
    expect(a.externalPublicationId).toBe(b.externalPublicationId);
  });

  it('[[mock:fail]] simula rejeição definitiva (não retryable)', async () => {
    const connector = new FakeConnector('x');
    const promise = connector.publish(
      { text: `post ruim ${MOCK_MARKERS.fail}`, media: [] },
      mockConnection('x'),
    );
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.PROVIDER_REJECTED_CONTENT,
      retryable: false,
    });
  });

  it('[[mock:ratelimit]] simula 429 retryable', async () => {
    const connector = new FakeConnector('threads');
    const promise = connector.publish(
      { text: `spam ${MOCK_MARKERS.rateLimit}`, media: [] },
      mockConnection('threads'),
    );
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
      httpStatus: 429,
      retryable: true,
    });
  });

  it('[[mock:unavailable]] simula 503 retryable', async () => {
    const connector = new FakeConnector('facebook_page');
    await expect(
      connector.publish(
        { text: `... ${MOCK_MARKERS.unavailable}`, media: [] },
        mockConnection('facebook_page'),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE, retryable: true });
  });

  it('[[mock:slow]] publica e o status fica "processing" antes de "published"', async () => {
    const connector = new FakeConnector('threads');
    const conn = mockConnection('threads');
    const { externalPublicationId } = await connector.publish(
      { text: `demorado ${MOCK_MARKERS.slow}`, media: [] },
      conn,
    );

    expect((await connector.getPublishStatus(externalPublicationId, conn)).status).toBe('processing');
    expect((await connector.getPublishStatus(externalPublicationId, conn)).status).toBe('processing');
    const final = await connector.getPublishStatus(externalPublicationId, conn);
    expect(final.status).toBe('published');
    expect(final.externalUrl).toContain(externalPublicationId);
  });

  it('[[mock:flaky]] falha (retryable) na 1ª tentativa e publica na 2ª', async () => {
    const connector = new FakeConnector('threads');
    const conn = mockConnection('threads');
    const input = { text: `instável ${MOCK_MARKERS.flaky}`, media: [] };

    await expect(connector.publish(input, conn)).rejects.toMatchObject({
      code: ErrorCode.PROVIDER_UNAVAILABLE,
      retryable: true,
    });

    const second = await connector.publish(input, conn);
    expect(second.externalPublicationId).toMatch(/^mock-threads-/);
  });

  it('revalida antes de publicar: texto sem mídia no Instagram falha com MEDIA_REQUIRED', async () => {
    const connector = new FakeConnector('instagram');
    await expect(
      connector.publish({ text: 'sem mídia', media: [] }, mockConnection('instagram')),
    ).rejects.toMatchObject({ code: ErrorCode.MEDIA_REQUIRED });
  });
});

describe('FakeConnector — OAuth e perfil', () => {
  it('troca código mock por tokens mock', async () => {
    const connector = new FakeConnector('x');
    const tokens = await connector.exchangeAuthorizationCode({
      code: 'mock-code-x-user-1',
      state: 'state-1',
      redirectUri: 'http://localhost:4000/cb',
    });
    expect(tokens.accessToken).toBe('mock-access-token-x');
    expect(tokens.scopes.length).toBeGreaterThan(0);
  });

  it('rejeita código que não seja mock', async () => {
    const connector = new FakeConnector('x');
    await expect(
      connector.exchangeAuthorizationCode({
        code: 'real-looking-code',
        state: 's',
        redirectUri: 'http://localhost:4000/cb',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('perfil mock do Instagram é conta business (exigência da API real)', async () => {
    const connector = new FakeConnector('instagram');
    const profile = await connector.getProfile(mockConnection('instagram'));
    expect(profile.accountType).toBe('business');
    expect(profile.username).toBe('mock_instagram');
  });

  it('getAuthorizationUrl aponta de volta para o redirectUri com código mock', async () => {
    const connector = new FakeConnector('threads');
    const url = await connector.getAuthorizationUrl({
      userId: 'user-1',
      redirectUri: 'http://localhost:4000/api/v1/social-connections/threads/callback',
    });
    expect(url).toContain('code=mock-code-threads-user-1');
    expect(url).toContain('mock=true');
  });
});

describe('createConnectorRegistry', () => {
  it('modo mock disponibiliza os quatro provedores do MVP', () => {
    const registry = createConnectorRegistry('mock');
    expect(registry.available().sort()).toEqual(['facebook_page', 'instagram', 'threads', 'x']);
    expect(registry.get('x').provider).toBe('x');
  });

  it('modo live falha explicitamente sem conectores reais — nunca cai para mock', () => {
    const registry = createConnectorRegistry('live');
    expect(registry.available()).toEqual([]);
    expect(() => registry.get('x')).toThrow(/live.*não está disponível|Fase 5/);
  });
});
