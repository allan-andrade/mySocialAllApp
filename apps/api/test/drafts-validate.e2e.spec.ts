import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@social-publisher/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, registerTestUser } from './helpers';

const EMAIL = `e2e-drafts-${Date.now()}@example.com`;
const OTHER_EMAIL = `e2e-drafts-other-${Date.now()}@example.com`;

describe('Drafts + validação de publicação (e2e)', () => {
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

  it('CRUD de rascunho com personalização por plataforma', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      headers: { cookie },
      payload: {
        text: 'meu rascunho',
        selectedProviders: ['x', 'threads'],
        providerOverrides: { x: { text: 'versão pro X' } },
      },
    });
    expect(created.statusCode).toBe(201);
    const draftId = created.json().id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/drafts/${draftId}`,
      headers: { cookie },
      payload: { text: 'rascunho atualizado' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().text).toBe('rascunho atualizado');
    expect(updated.json().providerOverrides).toEqual({ x: { text: 'versão pro X' } });

    // Isolamento: outro usuário não lê nem apaga.
    const foreignGet = await app.inject({
      method: 'GET',
      url: `/api/v1/drafts/${draftId}`,
      headers: { cookie: otherCookie },
    });
    expect(foreignGet.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/drafts/${draftId}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);
  });

  it('POST /publications/validate responde por plataforma no formato da seção 12', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/publications/validate',
      headers: { cookie },
      payload: {
        text: 'a'.repeat(300),
        providers: ['x', 'threads', 'instagram'],
        media: [],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.valid).toBe(false);

    expect(body.providers.x.valid).toBe(false);
    expect(body.providers.x.characterCount).toBe(300);
    expect(body.providers.x.maxCharacters).toBe(280);
    expect(body.providers.x.errors[0].code).toBe('TEXT_TOO_LONG');
    expect(body.providers.x.errors[0].message).toContain('Remova 20 caracteres');

    expect(body.providers.threads.valid).toBe(true);
    expect(body.providers.threads.errors).toEqual([]);

    expect(body.providers.instagram.valid).toBe(false);
    expect(
      body.providers.instagram.errors.some((e: { code: string }) => e.code === 'MEDIA_REQUIRED'),
    ).toBe(true);
  });

  it('personalização por plataforma é usada na validação', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/publications/validate',
      headers: { cookie },
      payload: {
        text: 'a'.repeat(300),
        providers: ['x'],
        providerOverrides: { x: { text: 'curto' } },
        media: [],
      },
    });
    expect(response.json().providers.x.valid).toBe(true);
  });
});
