import type { TokenCipher } from '@social-publisher/crypto';
import type { PrismaClient } from '@social-publisher/database';
import { AppError, ErrorCode, type SocialProvider } from '@social-publisher/shared';
import {
  getProviderPolicy,
  validatePostAgainstPolicy,
  type ConnectorRegistry,
  type ProviderPostInput,
  type SocialConnection as ConnectorConnection,
} from '@social-publisher/social-connectors';

import { recomputePublicationStatus } from './publication-status';

export interface ProcessorDeps {
  prisma: PrismaClient;
  registry: ConnectorRegistry;
  cipher: TokenCipher;
  presignMediaUrl: (storageKey: string) => Promise<string>;
  /** Intervalo entre consultas de status do provedor (curto nos testes). */
  statusPollIntervalMs?: number;
}

export interface AttemptInfo {
  attemptNumber: number;
  maxAttempts: number;
  correlationId?: string;
}

export type ProcessOutcome =
  | { outcome: 'published'; externalUrl: string | null }
  | { outcome: 'skipped'; reason: string };

const STATUS_POLL_LIMIT = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Processa UM destino de publicação (um job = uma plataforma). A ordem espelha as
 * etapas reais: validar → mídia → container → publicar → aguardar processamento.
 * Cada transição de status é persistida para o frontend acompanhar ao vivo.
 */
export async function processPublicationTarget(
  deps: ProcessorDeps,
  publicationTargetId: string,
  attempt: AttemptInfo,
): Promise<ProcessOutcome> {
  const { prisma } = deps;

  const target = await prisma.publicationTarget.findUnique({
    where: { id: publicationTargetId },
    include: {
      publication: { include: { media: { include: { mediaAsset: true }, orderBy: { position: 'asc' } } } },
      socialConnection: true,
      facebookPageConnection: true,
    },
  });
  if (!target) {
    return { outcome: 'skipped', reason: 'target não existe mais' };
  }

  // Mutex via transição condicional: só um consumidor sai de PENDING/RETRY_SCHEDULED.
  // Jobs duplicados, cancelamentos e re-entregas são descartados aqui (idempotência).
  const claimed = await prisma.publicationTarget.updateMany({
    where: { id: target.id, status: { in: ['PENDING', 'RETRY_SCHEDULED'] } },
    data: { status: 'VALIDATING', attemptCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return { outcome: 'skipped', reason: `status atual (${target.status}) não é processável` };
  }

  const attemptNumber = target.attemptCount + 1;
  const attemptRecord = await prisma.publicationAttempt.create({
    data: {
      publicationTargetId: target.id,
      attemptNumber,
      status: 'RUNNING',
      requestCorrelationId: attempt.correlationId ?? null,
    },
  });

  const setStatus = (status: string) =>
    prisma.publicationTarget.update({
      where: { id: target.id },
      data: { status: status as never },
    });

  try {
    const provider = target.provider as SocialProvider;
    const connector = deps.registry.get(provider);
    const policy = getProviderPolicy(provider);
    const text = target.customText ?? target.publication.baseText;

    if (target.socialConnection.status !== 'CONNECTED' || !target.socialConnection.encryptedAccessToken) {
      throw new AppError(
        ErrorCode.TOKEN_REVOKED,
        'A conta desta plataforma foi desconectada. Reconecte e tente novamente.',
        401,
        false,
      );
    }
    // O token só é descriptografado aqui, no worker, imediatamente antes do uso.
    const accessToken = deps.cipher.decrypt(target.socialConnection.encryptedAccessToken);
    const refreshToken = target.socialConnection.encryptedRefreshToken
      ? deps.cipher.decrypt(target.socialConnection.encryptedRefreshToken)
      : undefined;

    // Revalidação final imediatamente antes de chamar a API externa (seção 5).
    const mediaForValidation = target.publication.media.map((item) => ({
      mimeType: item.mediaAsset.mimeType,
      sizeBytes: item.mediaAsset.sizeBytes,
      durationSeconds: item.mediaAsset.durationSeconds ?? undefined,
    }));
    const validation = validatePostAgainstPolicy({ text, media: mediaForValidation }, policy);
    if (!validation.valid) {
      const first = validation.errors[0]!;
      throw new AppError(first.code as ErrorCode, first.message, 422, false);
    }

    // Mídia: URLs temporárias controladas para o provedor consumir (seção 13).
    let postInput: ProviderPostInput = { text, media: [] };
    if (target.publication.media.length > 0) {
      await setStatus('UPLOADING_MEDIA');
      postInput = {
        text,
        media: await Promise.all(
          target.publication.media.map(async (item) => ({
            url: await deps.presignMediaUrl(item.mediaAsset.storageKey),
            mimeType: item.mediaAsset.mimeType,
            altText: item.altText ?? undefined,
          })),
        ),
      };
    }

    const connectorConnection: ConnectorConnection = {
      id: target.socialConnection.id,
      userId: target.socialConnection.userId,
      provider,
      externalAccountId: target.socialConnection.externalAccountId,
      accountType: target.socialConnection.accountType ?? undefined,
      status: 'CONNECTED',
      accessToken,
      refreshToken,
      // Facebook: publica na Página selecionada, com o page token dela.
      page: target.facebookPageConnection
        ? {
            pageId: target.facebookPageConnection.pageId,
            pageName: target.facebookPageConnection.pageName,
            accessToken: target.facebookPageConnection.encryptedPageAccessToken
              ? deps.cipher.decrypt(target.facebookPageConnection.encryptedPageAccessToken)
              : undefined,
          }
        : undefined,
    };

    // Provedores baseados em container (Instagram/Threads) têm etapa própria.
    if (provider === 'instagram' || provider === 'threads') {
      await setStatus('CREATING_CONTAINER');
    }
    await setStatus('PUBLISHING');

    const result = await connector.publish(postInput, connectorConnection);

    // Criar o container não é publicar: acompanha o processamento até o fim (seção 2).
    let externalUrl = result.externalUrl ?? null;
    if (connector.getPublishStatus) {
      await setStatus('WAITING_PROCESSING');
      const pollInterval = deps.statusPollIntervalMs ?? 500;
      let published = false;
      for (let i = 0; i < STATUS_POLL_LIMIT; i++) {
        const status = await connector.getPublishStatus(
          result.externalPublicationId,
          connectorConnection,
        );
        if (status.status === 'published') {
          externalUrl = status.externalUrl ?? externalUrl;
          published = true;
          break;
        }
        if (status.status === 'failed') {
          throw new AppError(
            ErrorCode.PROVIDER_REJECTED_CONTENT,
            'O provedor falhou ao processar a publicação.',
            422,
            false,
          );
        }
        await sleep(pollInterval);
      }
      if (!published) {
        throw new AppError(
          ErrorCode.MEDIA_PROCESSING_FAILED,
          'O provedor ainda está processando a mídia. Nova tentativa em instantes.',
          503,
          true,
        );
      }
    }

    await prisma.publicationTarget.update({
      where: { id: target.id },
      data: {
        status: 'PUBLISHED',
        externalPublicationId: result.externalPublicationId,
        externalUrl,
        publishedAt: new Date(),
        retryable: false,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    await prisma.publicationAttempt.update({
      where: { id: attemptRecord.id },
      data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        sanitizedResponse: {
          externalPublicationId: result.externalPublicationId,
          externalUrl,
        },
      },
    });
    await recomputePublicationStatus(prisma, target.publicationId);
    return { outcome: 'published', externalUrl };
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(
            ErrorCode.UNKNOWN_PROVIDER_ERROR,
            error instanceof Error ? error.message : 'Erro desconhecido do provedor.',
            500,
            true, // erros não mapeados (rede, timeout) são tratados como temporários
          );

    const hasMoreAttempts = attempt.attemptNumber < attempt.maxAttempts;
    const nextStatus = appError.retryable && hasMoreAttempts ? 'RETRY_SCHEDULED' : 'FAILED';

    await prisma.publicationTarget.update({
      where: { id: target.id },
      data: {
        status: nextStatus,
        lastErrorCode: appError.code,
        lastErrorMessage: appError.message,
        retryable: appError.retryable,
      },
    });
    await prisma.publicationAttempt.update({
      where: { id: attemptRecord.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        providerHttpStatus: appError.httpStatus,
        normalizedErrorCode: appError.code,
        normalizedErrorMessage: appError.message,
      },
    });
    await recomputePublicationStatus(prisma, target.publicationId);
    throw appError;
  }
}
