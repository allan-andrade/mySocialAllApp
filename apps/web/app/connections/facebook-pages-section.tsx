'use client';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@social-publisher/ui';
import { useState } from 'react';

import {
  useConnectFacebookPage,
  useDisconnectFacebookPage,
  useFacebookPages,
} from '../../lib/queries';
import type { SocialConnectionDto } from '../../lib/types';

export function FacebookPagesSection({ connection }: { connection: SocialConnectionDto }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const pagesQuery = useFacebookPages(dialogOpen ? connection.id : null);
  const connectPage = useConnectFacebookPage();
  const disconnectPage = useDisconnectFacebookPage();

  const connectedPageIds = new Set(connection.facebookPages.map((p) => p.pageId));

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Páginas para publicação</p>
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
          Escolher Páginas
        </Button>
      </div>

      {connection.facebookPages.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma Página selecionada ainda — escolha ao menos uma para poder publicar.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {connection.facebookPages.map((page) => (
            <li key={page.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{page.pageName}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {page.status === 'ACTIVE' ? 'ativa' : page.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={disconnectPage.isPending}
                  onClick={() => disconnectPage.mutate(page.id)}
                >
                  Remover
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Páginas administradas</DialogTitle>
            <DialogDescription>
              Selecione as Páginas do Facebook em que você quer publicar.
            </DialogDescription>
          </DialogHeader>

          {pagesQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {pagesQuery.error && (
            <p className="text-sm text-destructive" role="alert">
              {pagesQuery.error.message}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {pagesQuery.data?.map((page) => {
              const alreadyConnected = connectedPageIds.has(page.pageId);
              return (
                <li
                  key={page.pageId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                >
                  <span className="truncate text-sm">{page.pageName}</span>
                  <Button
                    size="sm"
                    variant={alreadyConnected ? 'secondary' : 'default'}
                    disabled={alreadyConnected || connectPage.isPending}
                    onClick={() =>
                      connectPage.mutate({ connectionId: connection.id, pageId: page.pageId })
                    }
                  >
                    {alreadyConnected ? 'Conectada' : 'Conectar'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
