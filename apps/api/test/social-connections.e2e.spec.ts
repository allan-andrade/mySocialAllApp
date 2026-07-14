import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@social-publisher/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, registerTestUser } from './helpers';

const EMAIL = `e2e-conn-${Date.now()}@example.com`;
const OTHER_EMAIL = `e2e-conn-other-${Date.now()}@example.com`;

function locationOf(response: { headers: Record<string, unknown> }): string {
  return String(response.headers['location'] ?? '');
}

describe('Social connections — fluxo OAuth mock completo (e2e)', () => {
  let app: NestFastifyApplication;
  let cookie: string;
  let otherCookie: string;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    app = await createTestApp();
    cookie = await registerTestUser(app, EMAIL);
    otherCookie = await registerTestUser(app, OTHER_EMAIL);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL, OTHER_EMAIL] } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function connectProvider(provider: string, asCookie = cookie): Promise<void> {
    const authorize = await app.inject({
      method: 'GET',
      url: `/api/v1/social-connections/${provider}/authorize`,
      headers: { cookie: asCookie },
    });
    expect(authorize.statusCode).toBe(302);

    const authUrl = new URL(locationOf(authorize));
    const callback = await app.inject({
      method: 'GET',
      url: `${authUrl.pathname}${authUrl.search}`,
      headers: { cookie: asCookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(locationOf(callback)).toContain(`connected=${provider}`);
  }

  it('conecta as quatro plataformas do MVP via mock (critério de aceite 4)', async () => {
    for (const provider of ['instagram', 'threads', 'x', 'facebook_page']) {
      await connectProvider(provider);
    }

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/social-connections',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.mode).toBe('mock');
    expect(body.connections).toHaveLength(4);
    expect(body.connections.every((c: { status: string }) => c.status === 'CONNECTED')).toBe(true);
    // Tokens jamais aparecem na resposta — nem em claro, nem cifrados.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('mock-access-token');
    expect(serialized).not.toContain('mock-refresh-token');
    expect(serialized).not.toContain('encryptedAccessToken');
    expect(serialized).not.toContain('encryptedRefreshToken');
  });

  it('tokens ficam criptografados no banco (critério de aceite 16)', async () => {
    const connection = await prisma.socialConnection.findFirst({
      where: { provider: 'x', user: { email: EMAIL } },
    });
    expect(connection).not.toBeNull();
    expect(connection!.encryptedAccessToken.startsWith('v1.')).toBe(true);
    expect(connection!.encryptedAccessToken).not.toContain('mock-access-token');
  });

  it('replay do callback (mesmo state) falha e redireciona com erro', async () => {
    const authorize = await app.inject({
      method: 'GET',
      url: '/api/v1/social-connections/threads/authorize',
      headers: { cookie },
    });
    const authUrl = new URL(locationOf(authorize));
    const path = `${authUrl.pathname}${authUrl.search}`;

    const first = await app.inject({ method: 'GET', url: path, headers: { cookie } });
    expect(locationOf(first)).toContain('connected=threads');

    const replay = await app.inject({ method: 'GET', url: path, headers: { cookie } });
    expect(locationOf(replay)).toContain('error=');
  });

  it('state de um usuário não pode ser consumido por outro', async () => {
    const authorize = await app.inject({
      method: 'GET',
      url: '/api/v1/social-connections/threads/authorize',
      headers: { cookie },
    });
    const authUrl = new URL(locationOf(authorize));

    const hijack = await app.inject({
      method: 'GET',
      url: `${authUrl.pathname}${authUrl.search}`,
      headers: { cookie: otherCookie },
    });
    expect(locationOf(hijack)).toContain('error=');
  });

  it('PKCE: authorize do X inclui code_challenge S256', async () => {
    const authorize = await app.inject({
      method: 'GET',
      url: '/api/v1/social-connections/x/authorize',
      headers: { cookie },
    });
    const url = new URL(locationOf(authorize));
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('lista e conecta Páginas do Facebook', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/social-connections',
      headers: { cookie },
    });
    const fbConnection = list
      .json()
      .connections.find((c: { provider: string }) => c.provider === 'facebook_page');

    const pages = await app.inject({
      method: 'GET',
      url: `/api/v1/social-connections/${fbConnection.id}/facebook-pages`,
      headers: { cookie },
    });
    expect(pages.statusCode).toBe(200);
    expect(pages.json()).toHaveLength(2);

    const connect = await app.inject({
      method: 'POST',
      url: `/api/v1/social-connections/${fbConnection.id}/facebook-pages/mock-fb-page-1/connect`,
      headers: { cookie },
    });
    expect(connect.statusCode).toBe(201);
    expect(connect.json().pageName).toBe('Página Mock Principal');
  });

  it('isolamento entre usuários: conexão de A não é visível nem operável por B', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/social-connections',
      headers: { cookie: otherCookie },
    });
    expect(list.json().connections).toHaveLength(0);

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/social-connections',
      headers: { cookie },
    });
    const someId = mine.json().connections[0].id;

    const foreign = await app.inject({
      method: 'DELETE',
      url: `/api/v1/social-connections/${someId}`,
      headers: { cookie: otherCookie },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('desconecta removendo os tokens', async () => {
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/social-connections',
      headers: { cookie },
    });
    const threadsConn = mine
      .json()
      .connections.find((c: { provider: string }) => c.provider === 'threads');

    const disconnect = await app.inject({
      method: 'DELETE',
      url: `/api/v1/social-connections/${threadsConn.id}`,
      headers: { cookie },
    });
    expect(disconnect.statusCode).toBe(200);

    const row = await prisma.socialConnection.findUnique({ where: { id: threadsConn.id } });
    expect(row!.status).toBe('DISCONNECTED');
    expect(row!.encryptedAccessToken).toBe('');
    expect(row!.encryptedRefreshToken).toBeNull();
  });
});
