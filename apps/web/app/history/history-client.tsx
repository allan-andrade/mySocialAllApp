'use client';

import { Button, Card, CardContent, Input } from '@social-publisher/ui';
import { ExternalLink, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PublicationStatusBadge, TargetStatusBadge } from '../../components/status-badges';
import { PROVIDERS_META } from '../../lib/providers-meta';
import {
  createDraft,
  useDeletePublication,
  usePublications,
  useRetryPublication,
} from '../../lib/queries';
import type { PublicationDto } from '../../lib/types';

const STATUS_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'PUBLISHED', label: 'Publicadas' },
  { value: 'PARTIALLY_PUBLISHED', label: 'Parciais' },
  { value: 'FAILED', label: 'Falhas' },
  { value: 'PROCESSING', label: 'Processando' },
];

export function HistoryClient() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState('');
  const publicationsQuery = usePublications({ status, q, provider });
  const retryPublication = useRetryPublication();
  const deletePublication = useDeletePublication();

  async function duplicate(publication: PublicationDto): Promise<void> {
    const overrides: Record<string, { text: string }> = {};
    for (const target of publication.targets) {
      if (target.customText) overrides[target.provider] = { text: target.customText };
    }
    const draft = await createDraft({
      text: publication.baseText,
      selectedProviders: [...new Set(publication.targets.map((t) => t.provider))],
      providerOverrides: overrides as never,
    });
    router.push(`/compose?draft=${draft.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Histórico</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe o resultado de cada publicação, plataforma por plataforma.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            variant={status === filter.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Filtrar por plataforma"
        >
          <option value="">Todas as plataformas</option>
          {Object.values(PROVIDERS_META).map((meta) => (
            <option key={meta.id} value={meta.id}>
              {meta.name}
            </option>
          ))}
        </select>
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Buscar no texto..."
          className="h-9 w-56"
          aria-label="Buscar publicações por texto"
        />
      </div>

      {publicationsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      )}
      {publicationsQuery.error && (
        <p className="text-sm text-destructive" role="alert">
          {publicationsQuery.error.message}
        </p>
      )}
      {publicationsQuery.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma publicação ainda.{' '}
          <Link href="/compose" className="font-medium text-primary hover:underline">
            Criar a primeira
          </Link>
          .
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {publicationsQuery.data?.items.map((publication) => {
          const failedCount = publication.targets.filter((t) => t.status === 'FAILED').length;
          return (
            <li key={publication.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <PublicationStatusBadge status={publication.status} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(publication.createdAt).toLocaleString('pt-BR')}
                        </span>
                      </div>
                      <Link
                        href={`/history/${publication.id}`}
                        className="line-clamp-2 text-sm hover:underline"
                      >
                        {publication.baseText || '(publicação sem texto)'}
                      </Link>
                    </div>
                    {publication.media[0]?.url && (
                      publication.media[0].mimeType.startsWith('video/') ? (
                        <video
                          src={publication.media[0].url}
                          className="h-14 w-14 shrink-0 rounded object-cover"
                          muted
                        />
                      ) : (
                        <img
                          src={publication.media[0].url}
                          alt=""
                          className="h-14 w-14 shrink-0 rounded object-cover"
                        />
                      )
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {publication.targets.map((target) => {
                      const meta = PROVIDERS_META[target.provider];
                      const Icon = meta.icon;
                      return (
                        <span key={target.id} className="flex items-center gap-1">
                          <Icon className={`h-3.5 w-3.5 ${meta.accentClass}`} aria-hidden />
                          <TargetStatusBadge status={target.status} />
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                      <Link href={`/history/${publication.id}`}>Visualizar</Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => void duplicate(publication)}
                    >
                      Duplicar
                    </Button>
                    {failedCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={retryPublication.isPending}
                        onClick={() => retryPublication.mutate(publication.id)}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Tentar novamente ({failedCount})
                      </Button>
                    )}
                    {publication.targets.some((t) => t.externalUrl) && (
                      <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                        <a
                          href={publication.targets.find((t) => t.externalUrl)!.externalUrl!}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="mr-1 h-3 w-3" />
                          Ver publicada
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive"
                      disabled={deletePublication.isPending}
                      onClick={() => deletePublication.mutate(publication.id)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Excluir registro
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
