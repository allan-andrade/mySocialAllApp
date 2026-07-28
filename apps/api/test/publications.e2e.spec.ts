import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@social-publisher/database';
import { PUBLICATION_TARGETS_QUEUE, publicationTargetJobId } from '@social-publisher/shared';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, registerTestUser } from './helpers';

const EMAIL = `e2e-pub-${Date.now()}@example.com`;
const OTHER_EMAIL = `e2e-pub-other-${Date.now()}@example.com`;

function redisConnection() {
  const url = new URL(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  return { host: url.hostname, port: Number(url.port || 6379) };
}

describe('Publications API (e2e)', () => {
  let app: NestFastifyApplication;
  let cookie: string;
  let otherCookie: string;
  const prisma = new PrismaClient();
  const queue = new Queue(PUBLICATION_TARGETS_QUEUE, { connection: redisConnection() });

  async function connectProvider(provider: string): Promise<void> {
    const authorize = await app.inject({
      method: 'GET',
      url: `/api/v1/social-connections/${provider}/authorize`,
      headers: { cookie },
    });
    const authUrl = new URL(String(authorize.headers['location']));
    await app.inject({
      method: 'GET',
      url: `${authUrl.pathname}${authUrl.search}`,
      headers: { cookie },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    cookie = await registerTestUser(app, EMAIL);
    otherCookie = await registerTestUser(app, OTHER_EMAIL);
    await connectProvider('threads');
    await connectProvider('x');
    // Pausa o consumo para que as asserções sobre fila/estado sejam determinísticas
    // mesmo com um worker de desenvolvimento rodando.
    await queue.pause();
  });

  afterAll(async () => {
    await queue.resume();
    await queue.close();
    await prisma.publication.deleteMany({ where: { user: { email: { in: [EMAIL, OTHER_EMAIL] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL, OTHER_EMAIL] } } });
    await prisma.$disconnect();
    await app.close();
  });

  function createPayload(overrides: Record<string, unknown> = {}) {
    return {
      text: 'publicação de teste',
      providers: ['threads'],
      media: [],
      idempotencyKey: randomUUID(),
      ...overrides,
    };
  }

  it('cria a publicação com um destino/job independente por plataforma (critério 12)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload: createPayload({ providers: ['threads', 'x'] }),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('QUEUED');
    expect(body.targets).toHaveLength(2);
    expect(body.targets.map((t: { status: string }) => t.status)).toEqual(['PENDING', 'PENDING']);

    // Um job por destino, com a chave de idempotência determinística.
    const targets = await prisma.publicationTarget.findMany({
      where: { publicationId: body.id },
    });
    for (const target of targets) {
      const job = await queue.getJob(
        publicationTargetJobId(target.publicationId, target.socialConnectionId, target.revision),
      );
      expect(job).toBeDefined();
      expect(job!.data.publicationTargetId).toBe(target.id);
    }
  });

  it('repetir a requisição com a mesma chave devolve a MESMA publicação (200, sem duplicar)', async () => {
    const payload = createPayload();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);

    const count = await prisma.publication.count({
      where: { idempotencyKey: payload.idempotencyKey as string },
    });
    expect(count).toBe(1);
  });

  it('bloqueia conteúdo inválido antes de criar jobs (300 caracteres para o X)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload: createPayload({ text: 'a'.repeat(300), providers: ['x'] }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('bloqueia provedor sem conexão ativa', async () => {
    // facebook_page aceita texto puro (conteúdo válido), mas não foi conectado
    // neste teste — deve falhar na checagem de conexão, não na de conteúdo.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload: createPayload({ providers: ['facebook_page'] }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('AUTHORIZATION_REQUIRED');
  });

  it('cancela destino PENDING; retry de destino não-falho é rejeitado', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload: createPayload(),
    });
    const targetId = created.json().targets[0].id;

    const retryTooEarly = await app.inject({
      method: 'POST',
      url: `/api/v1/publication-targets/${targetId}/retry`,
      headers: { cookie },
    });
    expect(retryTooEarly.statusCode).toBe(409);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/publication-targets/${targetId}/cancel`,
      headers: { cookie },
    });
    expect(cancel.statusCode).toBe(200);

    const target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targetId } });
    expect(target.status).toBe('CANCELLED');

    const cancelAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/publication-targets/${targetId}/cancel`,
      headers: { cookie },
    });
    expect(cancelAgain.statusCode).toBe(409);
  });

  it('não cancela um destino já reivindicado pelo worker (update condicional)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload: createPayload(),
    });
    const targetId = created.json().targets[0].id;
    // Simula o worker tendo saído de PENDING (mutex de status).
    await prisma.publicationTarget.update({
      where: { id: targetId },
      data: { status: 'PUBLISHING' },
    });

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/publication-targets/${targetId}/cancel`,
      headers: { cookie },
    });
    expect(cancel.statusCode).toBe(409);

    // O status do worker permanece intocado — o cancel não pisou por cima.
    const target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targetId } });
    expect(target.status).toBe('PUBLISHING');
  });

  it('replay idempotente re-enfileira destinos ainda PENDING', async () => {
    const payload = createPayload();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload,
    });
    const targetId = first.json().targets[0].id;
    const target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targetId } });

    // Simula o job perdido (enqueue inicial falhou): remove-o da fila pausada.
    const jobId = publicationTargetJobId(
      target.publicationId,
      target.socialConnectionId,
      target.revision,
    );
    await (await queue.getJob(jobId))?.remove();
    expect(await queue.getJob(jobId)).toBeUndefined();

    // Repetir a requisição (mesma idempotencyKey) recria o job sem duplicar a publicação.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(await queue.getJob(jobId)).toBeDefined();
  });

  it('retry de destino FAILED reenfileira e marca PENDING', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload: createPayload(),
    });
    const targetId = created.json().targets[0].id;
    await prisma.publicationTarget.update({
      where: { id: targetId },
      data: { status: 'FAILED', lastErrorCode: 'RATE_LIMITED', retryable: true },
    });

    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/publication-targets/${targetId}/retry`,
      headers: { cookie },
    });
    expect(retry.statusCode).toBe(200);

    const target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targetId } });
    expect(target.status).toBe('PENDING');
    expect(target.lastErrorCode).toBeNull();

    const job = await queue.getJob(
      publicationTargetJobId(target.publicationId, target.socialConnectionId, target.revision),
    );
    expect(job).toBeDefined();
  });

  it('paginação por cursor no histórico', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/publications',
        headers: { cookie },
        payload: createPayload({ text: `paginada ${i}` }),
      });
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/v1/publications?limit=2',
      headers: { cookie },
    });
    const first = firstPage.json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/v1/publications?limit=2&cursor=${first.nextCursor}`,
      headers: { cookie },
    });
    const second = secondPage.json();
    expect(second.items.length).toBeGreaterThan(0);
    const firstIds = new Set(first.items.map((p: { id: string }) => p.id));
    expect(second.items.every((p: { id: string }) => !firstIds.has(p.id))).toBe(true);
  });

  it('isolamento entre usuários: publicação de A é 404 para B', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/publications',
      headers: { cookie },
      payload: createPayload(),
    });
    const id = created.json().id;

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/publications/${id}`,
      headers: { cookie: otherCookie },
    });
    expect(foreign.statusCode).toBe(404);
  });
});
