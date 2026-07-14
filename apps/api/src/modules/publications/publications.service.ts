import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  MediaAsset,
  Publication,
  PublicationMedia,
  PublicationTarget,
} from '@social-publisher/database';
import {
  AppError,
  ErrorCode,
  PUBLICATION_MAX_ATTEMPTS,
  publicationTargetJobId,
  type PublicationTargetJobData,
  type SocialProvider,
} from '@social-publisher/shared';
import {
  getProviderPolicy,
  validatePostAgainstPolicy,
  type ProviderValidationResult,
} from '@social-publisher/social-connectors';
import type {
  CreatePublicationInput,
  ValidatePublicationInput,
} from '@social-publisher/validation';
import type { Queue } from 'bullmq';

import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLICATION_TARGETS_QUEUE_TOKEN } from '../queue/queue.module';

export interface ValidatePublicationResponse {
  valid: boolean;
  providers: Record<string, ProviderValidationResult>;
}

type PublicationWithRelations = Publication & {
  targets: (PublicationTarget & {
    socialConnection: { username: string; provider: string };
    facebookPageConnection: { pageName: string } | null;
  })[];
  media: (PublicationMedia & { mediaAsset: MediaAsset })[];
};

const ACTIVE_TARGET_STATUSES = [
  'PENDING',
  'VALIDATING',
  'UPLOADING_MEDIA',
  'CREATING_CONTAINER',
  'WAITING_PROCESSING',
  'PUBLISHING',
  'RETRY_SCHEDULED',
] as const;

@Injectable()
export class PublicationsService {
  private readonly logger = new Logger(PublicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    @Inject(PUBLICATION_TARGETS_QUEUE_TOKEN)
    private readonly queue: Queue<PublicationTargetJobData>,
  ) {}

  /** Validação por plataforma (seção 12) — texto efetivo (override ou base) vs. política. */
  validate(input: ValidatePublicationInput): ValidatePublicationResponse {
    const providers: Record<string, ProviderValidationResult> = {};
    for (const provider of input.providers) {
      const text = input.providerOverrides?.[provider]?.text ?? input.text;
      providers[provider] = validatePostAgainstPolicy(
        { text, media: input.media },
        getProviderPolicy(provider as SocialProvider),
      );
    }
    return { valid: Object.values(providers).every((r) => r.valid), providers };
  }

  async create(userId: string, input: CreatePublicationInput) {
    // Idempotência da requisição (seção 9): repetição com a mesma chave devolve
    // a publicação já criada, sem enfileirar nada de novo.
    const existing = await this.prisma.publication.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      return { publication: await this.get(userId, existing.id), reused: true };
    }

    // Mídias precisam existir, pertencer ao usuário e estar prontas.
    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: input.media.map((m) => m.mediaAssetId) }, userId },
    });
    if (assets.length !== input.media.length) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Uma das mídias não foi encontrada.', 404);
    }
    if (assets.some((a) => a.processingStatus !== 'READY')) {
      throw new AppError(
        ErrorCode.MEDIA_PROCESSING_FAILED,
        'Há mídia ainda não processada. Aguarde e tente novamente.',
        400,
      );
    }

    // Revalidação server-side ANTES de criar jobs — nunca confiar só no frontend.
    const validation = this.validate({
      text: input.text,
      providers: input.providers,
      providerOverrides: input.providerOverrides,
      media: assets.map((a) => ({
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        durationSeconds: a.durationSeconds ?? undefined,
      })),
    });
    if (!validation.valid) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Conteúdo inválido para uma ou mais plataformas selecionadas.',
        400,
      );
    }

    // Conexões ativas para cada provedor selecionado.
    const connections = await this.prisma.socialConnection.findMany({
      where: { userId, provider: { in: input.providers }, status: 'CONNECTED' },
      include: { facebookPages: { where: { status: 'ACTIVE' } } },
    });
    const targetsData: Array<{
      socialConnectionId: string;
      provider: SocialProvider;
      customText: string | null;
      facebookPageConnectionId: string | null;
    }> = [];
    for (const provider of input.providers) {
      const connection = connections.find((c) => c.provider === provider);
      if (!connection) {
        throw new AppError(
          ErrorCode.AUTHORIZATION_REQUIRED,
          `A conta de ${provider} não está conectada.`,
          400,
        );
      }
      const customText = input.providerOverrides?.[provider]?.text ?? null;
      if (provider === 'facebook_page') {
        if (connection.facebookPages.length === 0) {
          throw new AppError(
            ErrorCode.ACCOUNT_NOT_SUPPORTED,
            'Escolha ao menos uma Página do Facebook em Conexões antes de publicar.',
            400,
          );
        }
        // Um destino independente por Página selecionada.
        for (const page of connection.facebookPages) {
          targetsData.push({
            socialConnectionId: connection.id,
            provider,
            customText,
            facebookPageConnectionId: page.id,
          });
        }
      } else {
        targetsData.push({
          socialConnectionId: connection.id,
          provider,
          customText,
          facebookPageConnectionId: null,
        });
      }
    }

    const publication = await this.prisma.$transaction(async (tx) => {
      const created = await tx.publication.create({
        data: {
          userId,
          draftId: input.draftId ?? null,
          baseText: input.text,
          status: 'QUEUED',
          idempotencyKey: input.idempotencyKey,
          media: {
            create: input.media.map((m, index) => ({
              mediaAssetId: m.mediaAssetId,
              position: index,
              altText: m.altText ?? null,
            })),
          },
        },
      });
      // Nota: unique(publicationId, socialConnectionId, revision) impede destino
      // duplicado para a mesma conexão; Páginas diferentes compartilham a conexão,
      // então a revisão diferencia (posição na lista).
      await tx.publicationTarget.createMany({
        data: targetsData.map((t, index) => ({
          publicationId: created.id,
          socialConnectionId: t.socialConnectionId,
          facebookPageConnectionId: t.facebookPageConnectionId,
          provider: t.provider,
          customText: t.customText,
          status: 'PENDING',
          revision: index,
        })),
      });
      return created;
    });

    await this.enqueuePendingTargets(publication.id);

    this.logger.log(
      JSON.stringify({
        event: 'publication_created',
        publicationId: publication.id,
        targets: targetsData.length,
      }),
    );
    return { publication: await this.get(userId, publication.id), reused: false };
  }

  async list(
    userId: string,
    options: {
      cursor?: string;
      limit?: number;
      status?: string;
      provider?: string;
      q?: string;
    },
  ) {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const publications = await this.prisma.publication.findMany({
      where: {
        userId,
        ...(options.status ? { status: options.status as Publication['status'] } : {}),
        ...(options.provider
          ? { targets: { some: { provider: options.provider as SocialProvider } } }
          : {}),
        ...(options.q ? { baseText: { contains: options.q, mode: 'insensitive' } } : {}),
      },
      include: {
        targets: {
          include: {
            socialConnection: { select: { username: true, provider: true } },
            facebookPageConnection: { select: { pageName: true } },
          },
          orderBy: { revision: 'asc' },
        },
        media: { include: { mediaAsset: true }, orderBy: { position: 'asc' } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = publications.length > limit;
    const page = hasMore ? publications.slice(0, limit) : publications;
    return {
      items: await Promise.all(page.map((p) => this.toDto(p))),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async get(userId: string, id: string) {
    const publication = await this.prisma.publication.findUnique({
      where: { id },
      include: {
        targets: {
          include: {
            socialConnection: { select: { username: true, provider: true } },
            facebookPageConnection: { select: { pageName: true } },
          },
          orderBy: { revision: 'asc' },
        },
        media: { include: { mediaAsset: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!publication || publication.userId !== userId) {
      throw new AppError(ErrorCode.PUBLICATION_NOT_FOUND, 'Publicação não encontrada.', 404);
    }
    return this.toDto(publication);
  }

  /** Reprocessa APENAS um destino com falha — sucesso das outras redes fica intocado. */
  async retryTarget(userId: string, targetId: string) {
    const target = await this.requireOwnedTarget(userId, targetId);
    if (target.status !== 'FAILED') {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Só é possível tentar novamente um destino que falhou.',
        409,
      );
    }

    const updated = await this.prisma.publicationTarget.update({
      where: { id: target.id },
      data: {
        status: 'PENDING',
        revision: { increment: 1000 }, // nova chave de idempotência para o novo ciclo
        lastErrorCode: null,
        lastErrorMessage: null,
        retryable: false,
      },
    });
    await this.prisma.publication.update({
      where: { id: target.publicationId },
      data: { status: 'PROCESSING' },
    });
    await this.enqueueTarget(updated);
    return { success: true };
  }

  /** Retry de todos os destinos com falha de uma publicação. */
  async retryPublication(userId: string, publicationId: string) {
    const publication = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      include: { targets: true },
    });
    if (!publication || publication.userId !== userId) {
      throw new AppError(ErrorCode.PUBLICATION_NOT_FOUND, 'Publicação não encontrada.', 404);
    }
    const failed = publication.targets.filter((t) => t.status === 'FAILED');
    if (failed.length === 0) {
      throw new AppError(ErrorCode.CONFLICT, 'Nenhum destino com falha para reprocessar.', 409);
    }
    for (const target of failed) {
      await this.retryTarget(userId, target.id);
    }
    return { success: true, retried: failed.length };
  }

  async cancelTarget(userId: string, targetId: string) {
    const target = await this.requireOwnedTarget(userId, targetId);
    if (target.status !== 'PENDING' && target.status !== 'RETRY_SCHEDULED') {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Este destino não pode mais ser cancelado.',
        409,
      );
    }
    await this.prisma.publicationTarget.update({
      where: { id: target.id },
      data: { status: 'CANCELLED' },
    });
    return { success: true };
  }

  /** Exclui o registro local (permitido só quando nada está em processamento). */
  async remove(userId: string, publicationId: string) {
    const publication = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      include: { targets: { select: { status: true } } },
    });
    if (!publication || publication.userId !== userId) {
      throw new AppError(ErrorCode.PUBLICATION_NOT_FOUND, 'Publicação não encontrada.', 404);
    }
    const active = publication.targets.some((t) =>
      (ACTIVE_TARGET_STATUSES as readonly string[]).includes(t.status),
    );
    if (active) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Aguarde o processamento terminar antes de excluir.',
        409,
      );
    }
    await this.prisma.publication.delete({ where: { id: publicationId } });
    return { success: true };
  }

  private async enqueuePendingTargets(publicationId: string): Promise<void> {
    const targets = await this.prisma.publicationTarget.findMany({
      where: { publicationId, status: 'PENDING' },
    });
    for (const target of targets) {
      await this.enqueueTarget(target);
    }
  }

  private async enqueueTarget(target: PublicationTarget): Promise<void> {
    await this.queue.add(
      'publish',
      { publicationTargetId: target.id },
      {
        jobId: publicationTargetJobId(
          target.publicationId,
          target.socialConnectionId,
          target.revision,
        ),
        attempts: PUBLICATION_MAX_ATTEMPTS,
        backoff: { type: 'custom' },
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  }

  private async requireOwnedTarget(userId: string, targetId: string) {
    const target = await this.prisma.publicationTarget.findUnique({
      where: { id: targetId },
      include: { publication: { select: { userId: true } } },
    });
    if (!target || target.publication.userId !== userId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Destino de publicação não encontrado.', 404);
    }
    return target;
  }

  private async toDto(publication: PublicationWithRelations) {
    return {
      id: publication.id,
      baseText: publication.baseText,
      status: publication.status,
      createdAt: publication.createdAt.toISOString(),
      publishedAt: publication.publishedAt?.toISOString() ?? null,
      targets: publication.targets.map((target) => ({
        id: target.id,
        provider: target.provider,
        username: target.socialConnection.username,
        pageName: target.facebookPageConnection?.pageName ?? null,
        customText: target.customText,
        status: target.status,
        attemptCount: target.attemptCount,
        externalUrl: target.externalUrl,
        lastErrorCode: target.lastErrorCode,
        lastErrorMessage: target.lastErrorMessage,
        retryable: target.retryable,
        publishedAt: target.publishedAt?.toISOString() ?? null,
      })),
      media: await Promise.all(
        publication.media.map(async (item) => ({
          mediaAssetId: item.mediaAssetId,
          position: item.position,
          altText: item.altText,
          mimeType: item.mediaAsset.mimeType,
          url:
            item.mediaAsset.processingStatus === 'READY'
              ? await this.media.presignedUrlFor(item.mediaAsset)
              : null,
        })),
      ),
    };
  }
}
