'use client';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@social-publisher/ui';
import { useState } from 'react';

import { textForProvider, type ProviderOverrides } from '../../lib/composer-logic';
import { PROVIDERS_META } from '../../lib/providers-meta';
import type { MvpProvider } from '../../lib/types';

import type { ComposerMediaItem } from './media-uploader';

export function PublishBar({
  selectedCount,
  blockers,
  providers,
  baseText,
  overrides,
  mediaItems,
  onConfirm,
  publishing,
  publishError,
}: {
  selectedCount: number;
  blockers: string[];
  providers: MvpProvider[];
  baseText: string;
  overrides: ProviderOverrides;
  mediaItems: ComposerMediaItem[];
  onConfirm: () => void;
  publishing: boolean;
  publishError: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const blocked = blockers.length > 0;
  const readyMedia = mediaItems.filter((item) => item.status === 'ready');

  const label =
    selectedCount === 0
      ? 'Publicar'
      : selectedCount === 1
        ? 'Publicar em 1 plataforma'
        : `Publicar em ${selectedCount} plataformas`;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {blocked ? blockers[0] : 'Tudo pronto para publicar.'}
          </div>
          <Button disabled={blocked} onClick={() => setConfirming(true)}>
            {label}
          </Button>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirmar publicação</DialogTitle>
            <DialogDescription>Revise o que será enviado para cada rede.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Plataformas
              </p>
              <div className="flex flex-wrap gap-1">
                {providers.map((provider) => (
                  <Badge key={provider} variant="secondary">
                    {PROVIDERS_META[provider].name}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Texto principal
              </p>
              <p className="whitespace-pre-wrap break-words rounded-md border border-border p-2 text-sm">
                {baseText || '(sem texto)'}
              </p>
            </div>

            {providers
              .filter((provider) => overrides[provider] !== undefined)
              .map((provider) => (
                <div key={provider}>
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Personalização — {PROVIDERS_META[provider].name}
                  </p>
                  <p className="whitespace-pre-wrap break-words rounded-md border border-border p-2 text-sm">
                    {textForProvider(baseText, overrides, provider)}
                  </p>
                </div>
              ))}

            {readyMedia.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                  Mídias ({readyMedia.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {readyMedia.map((item) =>
                    item.mimeType.startsWith('video/') ? (
                      <video
                        key={item.localId}
                        src={item.previewUrl}
                        className="h-14 w-14 rounded object-cover"
                        muted
                      />
                    ) : (
                      <img
                        key={item.localId}
                        src={item.previewUrl}
                        alt={item.altText || ''}
                        className="h-14 w-14 rounded object-cover"
                      />
                    ),
                  )}
                </div>
              </div>
            )}

            {publishError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {publishError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={publishing}>
              Voltar
            </Button>
            <Button onClick={onConfirm} disabled={publishing}>
              {publishing ? 'Enviando...' : 'Confirmar publicação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
