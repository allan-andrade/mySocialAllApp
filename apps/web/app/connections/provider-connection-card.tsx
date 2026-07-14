'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@social-publisher/ui';
import { useState } from 'react';

import type { ProviderMeta } from '../../lib/providers-meta';
import { connectAuthorizeUrl, useDisconnectConnection } from '../../lib/queries';
import type { SocialConnectionDto } from '../../lib/types';

import { FacebookPagesSection } from './facebook-pages-section';

function statusBadge(status: SocialConnectionDto['status']) {
  switch (status) {
    case 'CONNECTED':
      return <Badge variant="success">Conectada</Badge>;
    case 'EXPIRED':
      return <Badge variant="destructive">Expirada</Badge>;
    case 'REVOKED':
      return <Badge variant="destructive">Revogada</Badge>;
    case 'ERROR':
      return <Badge variant="destructive">Erro</Badge>;
    default:
      return <Badge variant="secondary">Desconectada</Badge>;
  }
}

export function ProviderConnectionCard({
  meta,
  connection,
  loading,
}: {
  meta: ProviderMeta;
  connection: SocialConnectionDto | undefined;
  loading: boolean;
}) {
  const disconnect = useDisconnectConnection();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const Icon = meta.icon;

  function goToAuthorize() {
    window.location.href = connectAuthorizeUrl(meta.id);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${meta.accentClass}`} aria-hidden />
            <CardTitle className="text-lg">{meta.name}</CardTitle>
          </div>
          {connection ? statusBadge(connection.status) : <Badge variant="secondary">Não conectada</Badge>}
        </div>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {meta.connectNote && (
          <p className="text-xs text-muted-foreground">{meta.connectNote}</p>
        )}

        {connection ? (
          <>
            <div className="flex items-center gap-3">
              {connection.avatarUrl ? (
                <img
                  src={connection.avatarUrl}
                  alt=""
                  className="h-9 w-9 rounded-full bg-muted object-cover"
                  onError={(event) => {
                    (event.target as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
              ) : (
                <div className="h-9 w-9 rounded-full bg-muted" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{connection.externalAccountName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  @{connection.username}
                  {connection.accountType ? ` · conta ${connection.accountType}` : ''}
                </p>
              </div>
            </div>

            {connection.scopes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {connection.scopes.map((scope) => (
                  <Badge key={scope} variant="outline" className="text-[10px]">
                    {scope}
                  </Badge>
                ))}
              </div>
            )}

            {connection.tokenExpiresAt && (
              <p className="text-xs text-muted-foreground">
                Acesso expira em{' '}
                {new Date(connection.tokenExpiresAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            )}

            {meta.id === 'facebook_page' && connection.status === 'CONNECTED' && (
              <FacebookPagesSection connection={connection} />
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={goToAuthorize}>
                Reconectar
              </Button>
              {confirmingDisconnect ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={disconnect.isPending}
                    onClick={() =>
                      disconnect.mutate(connection.id, {
                        onSettled: () => setConfirmingDisconnect(false),
                      })
                    }
                  >
                    {disconnect.isPending ? 'Desconectando...' : 'Confirmar'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingDisconnect(false)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDisconnect(true)}>
                  Desconectar
                </Button>
              )}
            </div>
          </>
        ) : (
          <Button size="sm" onClick={goToAuthorize} disabled={loading}>
            Conectar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
