/** Nomes das filas BullMQ, compartilhados entre API (produtora) e worker (consumidor). */
export const PUBLICATION_TARGETS_QUEUE = 'publication-targets';
export const PUBLICATION_TARGETS_DLQ = 'publication-targets-dlq';

/** Payload do job: um destino de publicação por job — cada plataforma falha ou publica sozinha. */
export interface PublicationTargetJobData {
  publicationTargetId: string;
}

/** Tentativas do BullMQ (1 execução inicial + retries com backoff exponencial e jitter). */
export const PUBLICATION_MAX_ATTEMPTS = 4;

export function publicationTargetJobId(
  publicationId: string,
  socialConnectionId: string,
  revision: number,
): string {
  // Chave de idempotência do destino (seção 9): repetir o enfileiramento com a
  // mesma chave não cria um segundo job no BullMQ.
  return `${publicationId}:${socialConnectionId}:r${revision}`;
}
