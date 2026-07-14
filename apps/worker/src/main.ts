import { AppError } from '@social-publisher/shared';
import {
  PUBLICATION_MAX_ATTEMPTS,
  PUBLICATION_TARGETS_DLQ,
  PUBLICATION_TARGETS_QUEUE,
  type PublicationTargetJobData,
} from '@social-publisher/shared';
import { Queue, UnrecoverableError, Worker } from 'bullmq';

import { parseRedisConnection, resolveRedisUrl } from './config';
import { buildProcessorDeps } from './deps';
import { processPublicationTarget } from './publication-processor';

async function main(): Promise<void> {
  const connection = parseRedisConnection(resolveRedisUrl());
  const deps = buildProcessorDeps();

  const dlq = new Queue(PUBLICATION_TARGETS_DLQ, { connection });

  const worker = new Worker<PublicationTargetJobData>(
    PUBLICATION_TARGETS_QUEUE,
    async (job) => {
      const attemptNumber = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? PUBLICATION_MAX_ATTEMPTS;
      try {
        const result = await processPublicationTarget(deps, job.data.publicationTargetId, {
          attemptNumber,
          maxAttempts,
          correlationId: String(job.id),
        });
        console.info(
          JSON.stringify({
            event: 'target_processed',
            targetId: job.data.publicationTargetId,
            attemptNumber,
            ...result,
          }),
        );
      } catch (error) {
        if (error instanceof AppError && !error.retryable) {
          // Erros definitivos (permissão, conteúdo inválido, limite de caracteres,
          // conta incompatível) NÃO são repetidos automaticamente (seção 10).
          throw new UnrecoverableError(`${error.code}: ${error.message}`);
        }
        throw error; // temporário → BullMQ reagenda com backoff exponencial + jitter
      }
    },
    {
      connection,
      concurrency: 5,
      settings: {
        backoffStrategy: (attemptsMade: number) =>
          3000 * 2 ** Math.max(0, attemptsMade - 1) + Math.floor(Math.random() * 1000),
      },
    },
  );

  worker.on('ready', () =>
    console.info(`[worker] consumindo a fila "${PUBLICATION_TARGETS_QUEUE}" (mock/live conforme SOCIAL_CONNECTOR_MODE)`),
  );
  worker.on('failed', (job, error) => {
    if (!job) return;
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    const unrecoverable = error instanceof UnrecoverableError || error.name === 'UnrecoverableError';
    console.error(
      JSON.stringify({
        event: 'target_job_failed',
        jobId: job.id,
        attemptsMade: job.attemptsMade,
        exhausted,
        unrecoverable,
        // Mensagem normalizada — nunca payload bruto/tokens nos logs.
        reason: error.message,
      }),
    );
    if (exhausted || unrecoverable) {
      // Dead-letter queue para inspeção de jobs esgotados (seção 10).
      void dlq.add(
        'dead',
        { ...job.data, failedReason: error.message, sourceJobId: job.id },
        { removeOnComplete: false, removeOnFail: false },
      );
    }
  });
  worker.on('error', (error) => console.error('[worker] erro', error));

  const shutdown = async (): Promise<void> => {
    console.info('[worker] encerrando...');
    await worker.close();
    await dlq.close();
    await deps.prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error('[worker] erro fatal na inicialização', error);
  process.exit(1);
});
