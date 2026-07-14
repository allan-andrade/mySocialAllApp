import { randomUUID } from 'node:crypto';

import { createTokenCipherFromEnv } from '@social-publisher/crypto';
import { PrismaClient } from '@social-publisher/database';
import { PUBLICATION_MAX_ATTEMPTS } from '@social-publisher/shared';
import { createConnectorRegistry, MOCK_MARKERS } from '@social-publisher/social-connectors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { processPublicationTarget, type ProcessorDeps } from './publication-processor';

const prisma = new PrismaClient();
const cipher = createTokenCipherFromEnv();

const deps: ProcessorDeps = {
  prisma,
  cipher,
  registry: createConnectorRegistry('mock'),
  presignMediaUrl: async (key) => `https://storage.local/${key}?signed=1`,
  statusPollIntervalMs: 5,
};

let userId: string;
const connectionIds: Record<string, string> = {};

async function createPublication(options: {
  baseText: string;
  targets: Array<{ provider: 'threads' | 'x' | 'instagram'; customText?: string }>;
}) {
  const publication = await prisma.publication.create({
    data: {
      userId,
      baseText: options.baseText,
      status: 'QUEUED',
      idempotencyKey: randomUUID(),
    },
  });
  const targets = [];
  for (const [index, t] of options.targets.entries()) {
    targets.push(
      await prisma.publicationTarget.create({
        data: {
          publicationId: publication.id,
          socialConnectionId: connectionIds[t.provider]!,
          provider: t.provider,
          customText: t.customText ?? null,
          status: 'PENDING',
          revision: index,
        },
      }),
    );
  }
  return { publication, targets };
}

const firstAttempt = { attemptNumber: 1, maxAttempts: PUBLICATION_MAX_ATTEMPTS };

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Worker Tester',
      email: `worker-${Date.now()}@example.com`,
      passwordHash: 'irrelevante',
    },
  });
  userId = user.id;

  for (const provider of ['threads', 'x', 'instagram'] as const) {
    const connection = await prisma.socialConnection.create({
      data: {
        userId,
        provider,
        externalAccountId: `mock-${provider}-account-1`,
        externalAccountName: `Conta Mock (${provider})`,
        username: `mock_${provider}`,
        accountType: provider === 'instagram' ? 'business' : 'standard',
        encryptedAccessToken: cipher.encrypt(`mock-access-token-${provider}`),
        scopes: [],
        status: 'CONNECTED',
      },
    });
    connectionIds[provider] = connection.id;
  }
});

afterAll(async () => {
  // Targets referenciam conexões com onDelete: Restrict — apagar publicações primeiro.
  await prisma.publication.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('processPublicationTarget', () => {
  it('publica com sucesso: PUBLISHED + tentativa SUCCEEDED + publicação PUBLISHED', async () => {
    const { publication, targets } = await createPublication({
      baseText: 'post feliz',
      targets: [{ provider: 'threads' }],
    });

    const result = await processPublicationTarget(deps, targets[0]!.id, firstAttempt);
    expect(result.outcome).toBe('published');

    const target = await prisma.publicationTarget.findUniqueOrThrow({
      where: { id: targets[0]!.id },
      include: { attempts: true },
    });
    expect(target.status).toBe('PUBLISHED');
    expect(target.externalPublicationId).toMatch(/^mock-threads-/);
    expect(target.externalUrl).toContain('mock.social');
    expect(target.attemptCount).toBe(1);
    expect(target.attempts[0]!.status).toBe('SUCCEEDED');

    const pub = await prisma.publication.findUniqueOrThrow({ where: { id: publication.id } });
    expect(pub.status).toBe('PUBLISHED');
    expect(pub.publishedAt).not.toBeNull();
  });

  it('erro definitivo ([[mock:fail]]): FAILED sem retry, tentativa registrada', async () => {
    const { publication, targets } = await createPublication({
      baseText: `ruim ${MOCK_MARKERS.fail}`,
      targets: [{ provider: 'threads' }],
    });

    await expect(processPublicationTarget(deps, targets[0]!.id, firstAttempt)).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED_CONTENT',
      retryable: false,
    });

    const target = await prisma.publicationTarget.findUniqueOrThrow({
      where: { id: targets[0]!.id },
      include: { attempts: true },
    });
    expect(target.status).toBe('FAILED'); // não RETRY_SCHEDULED: erro definitivo
    expect(target.retryable).toBe(false);
    expect(target.lastErrorCode).toBe('PROVIDER_REJECTED_CONTENT');
    expect(target.attempts[0]!.providerHttpStatus).toBe(422);

    const pub = await prisma.publication.findUniqueOrThrow({ where: { id: publication.id } });
    expect(pub.status).toBe('FAILED');
  });

  it('erro temporário ([[mock:ratelimit]]): RETRY_SCHEDULED enquanto houver tentativas', async () => {
    const { publication, targets } = await createPublication({
      baseText: `spam ${MOCK_MARKERS.rateLimit}`,
      targets: [{ provider: 'threads' }],
    });

    await expect(processPublicationTarget(deps, targets[0]!.id, firstAttempt)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });

    let target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targets[0]!.id } });
    expect(target.status).toBe('RETRY_SCHEDULED');
    expect(target.retryable).toBe(true);

    const pub = await prisma.publication.findUniqueOrThrow({ where: { id: publication.id } });
    expect(pub.status).toBe('PROCESSING');

    // Na última tentativa, o mesmo erro vira FAILED de vez.
    await expect(
      processPublicationTarget(deps, targets[0]!.id, {
        attemptNumber: PUBLICATION_MAX_ATTEMPTS,
        maxAttempts: PUBLICATION_MAX_ATTEMPTS,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targets[0]!.id } });
    expect(target.status).toBe('FAILED');
    expect(target.attemptCount).toBe(2);
  });

  it('instabilidade ([[mock:flaky]]): falha na 1ª e publica na 2ª tentativa', async () => {
    const { publication, targets } = await createPublication({
      baseText: `instável ${MOCK_MARKERS.flaky} ${Date.now()}`,
      targets: [{ provider: 'threads' }],
    });

    await expect(processPublicationTarget(deps, targets[0]!.id, firstAttempt)).rejects.toMatchObject({
      retryable: true,
    });

    const second = await processPublicationTarget(deps, targets[0]!.id, {
      attemptNumber: 2,
      maxAttempts: PUBLICATION_MAX_ATTEMPTS,
    });
    expect(second.outcome).toBe('published');

    const target = await prisma.publicationTarget.findUniqueOrThrow({
      where: { id: targets[0]!.id },
      include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
    });
    expect(target.status).toBe('PUBLISHED');
    expect(target.attempts.map((a) => a.status)).toEqual(['FAILED', 'SUCCEEDED']);

    const pub = await prisma.publication.findUniqueOrThrow({ where: { id: publication.id } });
    expect(pub.status).toBe('PUBLISHED');
  });

  it('processamento demorado ([[mock:slow]]): passa por WAITING_PROCESSING e publica', async () => {
    const { targets } = await createPublication({
      baseText: `demorado ${MOCK_MARKERS.slow}`,
      targets: [{ provider: 'threads' }],
    });

    const result = await processPublicationTarget(deps, targets[0]!.id, firstAttempt);
    expect(result.outcome).toBe('published');

    const target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targets[0]!.id } });
    expect(target.status).toBe('PUBLISHED');
  });

  it('resultado parcial: falha no X não desfaz o Threads publicado', async () => {
    const { publication, targets } = await createPublication({
      baseText: 'texto principal ok',
      targets: [
        { provider: 'threads' },
        { provider: 'x', customText: `só o X falha ${MOCK_MARKERS.fail}` },
      ],
    });

    await processPublicationTarget(deps, targets[0]!.id, firstAttempt);
    await expect(processPublicationTarget(deps, targets[1]!.id, firstAttempt)).rejects.toThrow();

    const rows = await prisma.publicationTarget.findMany({
      where: { publicationId: publication.id },
      orderBy: { revision: 'asc' },
    });
    expect(rows[0]!.status).toBe('PUBLISHED');
    expect(rows[1]!.status).toBe('FAILED');

    const pub = await prisma.publication.findUniqueOrThrow({ where: { id: publication.id } });
    expect(pub.status).toBe('PARTIALLY_PUBLISHED');
  });

  it('destino cancelado é pulado sem processar (mutex de status)', async () => {
    const { targets } = await createPublication({
      baseText: 'cancelado antes de processar',
      targets: [{ provider: 'threads' }],
    });
    await prisma.publicationTarget.update({
      where: { id: targets[0]!.id },
      data: { status: 'CANCELLED' },
    });

    const result = await processPublicationTarget(deps, targets[0]!.id, firstAttempt);
    expect(result.outcome).toBe('skipped');

    const target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targets[0]!.id } });
    expect(target.status).toBe('CANCELLED');
    expect(target.attemptCount).toBe(0);
  });

  it('destino já publicado não é republicado (idempotência na reentrega do job)', async () => {
    const { targets } = await createPublication({
      baseText: 'publicado uma única vez',
      targets: [{ provider: 'threads' }],
    });

    await processPublicationTarget(deps, targets[0]!.id, firstAttempt);
    const replay = await processPublicationTarget(deps, targets[0]!.id, {
      attemptNumber: 1,
      maxAttempts: PUBLICATION_MAX_ATTEMPTS,
    });
    expect(replay.outcome).toBe('skipped');

    const target = await prisma.publicationTarget.findUniqueOrThrow({ where: { id: targets[0]!.id } });
    expect(target.attemptCount).toBe(1); // nenhuma tentativa extra
  });

  it('conta desconectada falha de forma definitiva com TOKEN_REVOKED', async () => {
    const { targets } = await createPublication({
      baseText: 'sem conexão',
      targets: [{ provider: 'x' }],
    });
    await prisma.socialConnection.update({
      where: { id: connectionIds['x']! },
      data: { status: 'DISCONNECTED', encryptedAccessToken: '' },
    });

    await expect(processPublicationTarget(deps, targets[0]!.id, firstAttempt)).rejects.toMatchObject({
      code: 'TOKEN_REVOKED',
      retryable: false,
    });

    // restaura para os demais testes
    await prisma.socialConnection.update({
      where: { id: connectionIds['x']! },
      data: { status: 'CONNECTED', encryptedAccessToken: cipher.encrypt('mock-access-token-x') },
    });
  });
});
