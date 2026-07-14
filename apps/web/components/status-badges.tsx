import { Badge } from '@social-publisher/ui';

import type { PublicationStatus, PublicationTargetStatus } from '../lib/types';

const PUBLICATION_LABELS: Record<PublicationStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'success' | 'outline' }> = {
  DRAFT: { label: 'Rascunho', variant: 'secondary' },
  QUEUED: { label: 'Na fila', variant: 'secondary' },
  PROCESSING: { label: 'Processando', variant: 'secondary' },
  PARTIALLY_PUBLISHED: { label: 'Parcialmente publicada', variant: 'outline' },
  PUBLISHED: { label: 'Publicada', variant: 'success' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
  CANCELLED: { label: 'Cancelada', variant: 'secondary' },
};

const TARGET_LABELS: Record<PublicationTargetStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'success' | 'outline' }> = {
  PENDING: { label: 'Aguardando', variant: 'secondary' },
  VALIDATING: { label: 'Validando', variant: 'secondary' },
  UPLOADING_MEDIA: { label: 'Enviando mídia', variant: 'secondary' },
  CREATING_CONTAINER: { label: 'Criando container', variant: 'secondary' },
  WAITING_PROCESSING: { label: 'Processando no provedor', variant: 'secondary' },
  PUBLISHING: { label: 'Publicando', variant: 'secondary' },
  PUBLISHED: { label: 'Publicado', variant: 'success' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
  RETRY_SCHEDULED: { label: 'Nova tentativa agendada', variant: 'outline' },
  CANCELLED: { label: 'Cancelado', variant: 'secondary' },
};

export function PublicationStatusBadge({ status }: { status: PublicationStatus }) {
  const meta = PUBLICATION_LABELS[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export function TargetStatusBadge({ status }: { status: PublicationTargetStatus }) {
  const meta = TARGET_LABELS[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
