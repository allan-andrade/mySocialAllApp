import type { PrismaClient } from '@social-publisher/database';

const TERMINAL = new Set(['PUBLISHED', 'FAILED', 'CANCELLED']);

export type PublicationStatusValue =
  | 'QUEUED'
  | 'PROCESSING'
  | 'PARTIALLY_PUBLISHED'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Deriva o status geral da publicação a partir dos status dos destinos.
 * Cada destino termina de forma independente — sucesso parcial é um estado
 * de primeira classe, nunca um erro.
 */
export function computePublicationStatus(targetStatuses: string[]): PublicationStatusValue {
  if (targetStatuses.length === 0) return 'FAILED';

  const allTerminal = targetStatuses.every((status) => TERMINAL.has(status));
  const published = targetStatuses.filter((status) => status === 'PUBLISHED').length;

  if (!allTerminal) {
    const anyStarted = targetStatuses.some((status) => status !== 'PENDING');
    return anyStarted ? 'PROCESSING' : 'QUEUED';
  }

  if (published === targetStatuses.length) return 'PUBLISHED';
  if (published > 0) return 'PARTIALLY_PUBLISHED';
  if (targetStatuses.every((status) => status === 'CANCELLED')) return 'CANCELLED';
  return 'FAILED';
}

export async function recomputePublicationStatus(
  prisma: PrismaClient,
  publicationId: string,
): Promise<void> {
  const targets = await prisma.publicationTarget.findMany({
    where: { publicationId },
    select: { status: true },
  });
  const status = computePublicationStatus(targets.map((t) => t.status));
  const anyPublished = targets.some((t) => t.status === 'PUBLISHED');
  const terminal = ['PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'CANCELLED'].includes(status);

  await prisma.publication.update({
    where: { id: publicationId },
    data: {
      status,
      ...(terminal && anyPublished ? { publishedAt: new Date() } : {}),
    },
  });
}
