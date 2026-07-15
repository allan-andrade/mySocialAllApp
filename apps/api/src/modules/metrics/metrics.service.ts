import { Inject, Injectable } from '@nestjs/common';
import type { PublicationTargetJobData } from '@social-publisher/shared';
import type { Queue } from 'bullmq';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';

import { PrismaService } from '../prisma/prisma.service';
import { PUBLICATION_TARGETS_QUEUE_TOKEN } from '../queue/queue.module';

/**
 * Métricas Prometheus (seção 18). Como API e worker são processos separados,
 * as métricas de publicação são derivadas do banco no momento do scrape —
 * fonte única de verdade, sem plumbing entre processos. Apenas agregados:
 * nenhum texto de publicação, token ou dado sensível vira métrica ou label.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUBLICATION_TARGETS_QUEUE_TOKEN)
    private readonly queue: Queue<PublicationTargetJobData>,
  ) {
    collectDefaultMetrics({ register: this.registry, prefix: 'social_publisher_' });

    // Capturados em variáveis locais porque os hooks `collect()` do prom-client
    // rodam com `this` apontando para o próprio Gauge.
    const db = this.prisma;
    const targetsQueue = this.queue;

    new Gauge({
      name: 'social_publisher_publications',
      help: 'Publicações por status geral',
      labelNames: ['status'],
      registers: [this.registry],
      async collect() {
        const rows = await db.publication.groupBy({ by: ['status'], _count: true });
        this.reset();
        for (const row of rows) this.set({ status: row.status }, row._count);
      },
    });

    new Gauge({
      name: 'social_publisher_publication_targets',
      help: 'Destinos de publicação por provedor e status (sucesso/falha por plataforma)',
      labelNames: ['provider', 'status'],
      registers: [this.registry],
      async collect() {
        const rows = await db.publicationTarget.groupBy({
          by: ['provider', 'status'],
          _count: true,
        });
        this.reset();
        for (const row of rows) {
          this.set({ provider: row.provider, status: row.status }, row._count);
        }
      },
    });

    new Gauge({
      name: 'social_publisher_target_errors',
      help: 'Destinos com falha por código de erro normalizado',
      labelNames: ['code'],
      registers: [this.registry],
      async collect() {
        const rows = await db.publicationTarget.groupBy({
          by: ['lastErrorCode'],
          where: { lastErrorCode: { not: null } },
          _count: true,
        });
        this.reset();
        for (const row of rows) this.set({ code: row.lastErrorCode! }, row._count);
      },
    });

    new Gauge({
      name: 'social_publisher_publication_retries_total',
      help: 'Tentativas além da primeira (retries automáticos e manuais)',
      registers: [this.registry],
      async collect() {
        const count = await db.publicationAttempt.count({
          where: { attemptNumber: { gt: 1 } },
        });
        this.set(count);
      },
    });

    new Gauge({
      name: 'social_publisher_publish_duration_seconds_avg',
      help: 'Tempo médio (s) entre a criação do destino e a publicação, por provedor',
      labelNames: ['provider'],
      registers: [this.registry],
      async collect() {
        const rows = await db.$queryRaw<Array<{ provider: string; avg_seconds: number | null }>>`
          SELECT provider::text AS provider,
                 AVG(EXTRACT(EPOCH FROM ("publishedAt" - "createdAt")))::float8 AS avg_seconds
          FROM publication_targets
          WHERE "publishedAt" IS NOT NULL
          GROUP BY provider
        `;
        this.reset();
        for (const row of rows) {
          if (row.avg_seconds !== null) this.set({ provider: row.provider }, row.avg_seconds);
        }
      },
    });

    new Gauge({
      name: 'social_publisher_queue_jobs',
      help: 'Jobs na fila de destinos de publicação, por estado do BullMQ',
      labelNames: ['state'],
      registers: [this.registry],
      async collect() {
        const counts = await targetsQueue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
          'paused',
        );
        this.reset();
        for (const [state, value] of Object.entries(counts)) {
          this.set({ state }, value ?? 0);
        }
      },
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
