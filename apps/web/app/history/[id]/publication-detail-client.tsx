'use client';

import { Button, Card, CardContent } from '@social-publisher/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, RotateCcw, XCircle } from 'lucide-react';
import Link from 'next/link';

import { PublicationStatusBadge, TargetStatusBadge } from '../../../components/status-badges';
import { apiFetch } from '../../../lib/api-client';
import { PROVIDERS_META } from '../../../lib/providers-meta';
import { isPublicationActive, usePublication, useRetryTarget } from '../../../lib/queries';

const CANCELLABLE = new Set(['PENDING', 'RETRY_SCHEDULED']);

export function PublicationDetailClient({ publicationId }: { publicationId: string }) {
  const publicationQuery = usePublication(publicationId);
  const retryTarget = useRetryTarget();
  const queryClient = useQueryClient();

  const publication = publicationQuery.data;

  async function cancelTarget(targetId: string): Promise<void> {
    await apiFetch(`/api/v1/publication-targets/${targetId}/cancel`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['publication'] });
  }

  if (publicationQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }
  if (publicationQuery.error || !publication) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Publicação não encontrada.{' '}
        <Link href="/history" className="underline">
          Voltar ao histórico
        </Link>
      </p>
    );
  }

  const live = isPublicationActive(publication);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Publicação</h1>
            <PublicationStatusBadge status={publication.status} />
            {live && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                atualizando ao vivo
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Criada em {new Date(publication.createdAt).toLocaleString('pt-BR')}
            {publication.publishedAt &&
              ` · concluída em ${new Date(publication.publishedAt).toLocaleString('pt-BR')}`}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/history">Voltar</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="whitespace-pre-wrap break-words text-sm">
            {publication.baseText || '(sem texto)'}
          </p>
          {publication.media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {publication.media.map((item) =>
                item.url ? (
                  item.mimeType.startsWith('video/') ? (
                    <video
                      key={item.mediaAssetId}
                      src={item.url}
                      className="h-20 w-20 rounded object-cover"
                      muted
                      controls
                    />
                  ) : (
                    <img
                      key={item.mediaAssetId}
                      src={item.url}
                      alt={item.altText ?? ''}
                      className="h-20 w-20 rounded object-cover"
                    />
                  )
                ) : null,
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Resultado por plataforma</h2>
        <ul className="flex flex-col gap-3">
          {publication.targets.map((target) => {
            const meta = PROVIDERS_META[target.provider];
            const Icon = meta.icon;
            return (
              <li key={target.id}>
                <Card>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${meta.accentClass}`} aria-hidden />
                        <span className="text-sm font-medium">
                          {meta.name}
                          {target.pageName ? ` — ${target.pageName}` : ''}
                        </span>
                        <span className="text-xs text-muted-foreground">@{target.username}</span>
                      </div>
                      <TargetStatusBadge status={target.status} />
                    </div>

                    {target.customText && (
                      <p className="rounded-md bg-muted p-2 text-xs">
                        Texto personalizado: <span className="whitespace-pre-wrap">{target.customText}</span>
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {target.attemptCount}{' '}
                        {target.attemptCount === 1 ? 'tentativa' : 'tentativas'}
                      </span>
                      {target.publishedAt && (
                        <span>publicado em {new Date(target.publishedAt).toLocaleString('pt-BR')}</span>
                      )}
                    </div>

                    {target.status === 'FAILED' && target.lastErrorMessage && (
                      <p className="text-xs text-destructive" role="alert">
                        {target.lastErrorMessage}
                        {target.lastErrorCode ? ` (${target.lastErrorCode})` : ''}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {target.externalUrl && (
                        <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                          <a href={target.externalUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1 h-3 w-3" />
                            Abrir publicação
                          </a>
                        </Button>
                      )}
                      {target.status === 'FAILED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={retryTarget.isPending}
                          onClick={() => retryTarget.mutate(target.id)}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" />
                          Tentar novamente
                        </Button>
                      )}
                      {CANCELLABLE.has(target.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive"
                          onClick={() => void cancelTarget(target.id)}
                        >
                          <XCircle className="mr-1 h-3 w-3" />
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
