'use client';

import { Button, Input, Progress } from '@social-publisher/ui';
import { ArrowDown, ArrowUp, ImagePlus, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { ApiError, apiFetch } from '../../lib/api-client';
import type { MediaAssetDto } from '../../lib/types';
import { uploadMedia } from '../../lib/upload';

export interface ComposerMediaItem {
  localId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'uploading' | 'ready' | 'error';
  progress: number;
  error?: string;
  asset?: MediaAssetDto;
  altText: string;
  previewUrl: string;
  probedDurationSeconds?: number;
  abort?: () => void;
}

const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
]);

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function MediaUploader({
  items,
  onChange,
}: {
  items: ComposerMediaItem[];
  onChange: (updater: (current: ComposerMediaItem[]) => ComposerMediaItem[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const patchItem = useCallback(
    (localId: string, patch: Partial<ComposerMediaItem>) => {
      onChange((current) =>
        current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
      );
    },
    [onChange],
  );

  const startUpload = useCallback(
    (file: File) => {
      const localId = crypto.randomUUID();

      // Validação ANTES do upload: formato e presença de conteúdo.
      if (!ACCEPTED_TYPES.has(file.type)) {
        onChange((current) => [
          ...current,
          {
            localId,
            filename: file.name,
            mimeType: file.type || 'desconhecido',
            sizeBytes: file.size,
            status: 'error',
            progress: 0,
            error: `Formato não aceito (${file.type || 'desconhecido'}). Use JPEG, PNG, WebP, GIF, MP4 ou MOV.`,
            altText: '',
            previewUrl: '',
          },
        ]);
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      const handle = uploadMedia(file, (percent) => patchItem(localId, { progress: percent }));

      onChange((current) => [
        ...current,
        {
          localId,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          status: 'uploading',
          progress: 0,
          altText: '',
          previewUrl,
          abort: handle.abort,
        },
      ]);

      handle.promise
        .then((asset) => {
          patchItem(localId, {
            status: 'ready',
            progress: 100,
            asset,
            probedDurationSeconds: asset.durationSeconds ?? undefined,
            abort: undefined,
          });
        })
        .catch((error: unknown) => {
          const message =
            error instanceof ApiError || error instanceof Error
              ? error.message
              : 'Falha no upload.';
          if (message === 'Upload cancelado.') {
            onChange((current) => current.filter((item) => item.localId !== localId));
            URL.revokeObjectURL(previewUrl);
            return;
          }
          patchItem(localId, { status: 'error', error: message, abort: undefined });
        });
    },
    [onChange, patchItem],
  );

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) startUpload(file);
  }

  function removeItem(item: ComposerMediaItem) {
    if (item.status === 'uploading') {
      item.abort?.();
      return; // o catch do upload remove o item
    }
    if (item.asset) {
      void apiFetch(`/api/v1/media/${item.asset.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    onChange((current) => current.filter((i) => i.localId !== item.localId));
  }

  function move(index: number, direction: -1 | 1) {
    onChange((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Adicionar mídia (arraste arquivos ou clique)"
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors ${
          dragActive ? 'border-primary bg-accent' : 'border-border hover:border-primary/60'
        }`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <ImagePlus className="h-6 w-6" aria-hidden />
        <span>Arraste imagens ou vídeos aqui, ou clique para selecionar</span>
        <span className="text-xs">JPEG, PNG, WebP, GIF, MP4 ou MOV</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item, index) => (
            <li
              key={item.localId}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <div className="flex items-start gap-3">
                {item.previewUrl &&
                  (item.mimeType.startsWith('video/') ? (
                    <video
                      src={item.previewUrl}
                      className="h-16 w-16 shrink-0 rounded object-cover"
                      muted
                    />
                  ) : (
                    <img
                      src={item.previewUrl}
                      alt={item.altText || item.filename}
                      className="h-16 w-16 shrink-0 rounded object-cover"
                    />
                  ))}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.mimeType} · {formatSize(item.sizeBytes)}
                    {item.probedDurationSeconds !== undefined &&
                      ` · ${Math.round(item.probedDurationSeconds)}s`}
                  </p>
                  {item.status === 'uploading' && (
                    <div className="mt-2 flex items-center gap-2">
                      <Progress value={item.progress} className="flex-1" />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {Math.round(item.progress)}%
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => item.abort?.()}
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                  {item.status === 'error' && (
                    <p className="mt-1 text-xs text-destructive" role="alert">
                      {item.error}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Mover para cima"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Mover para baixo"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Remover mídia"
                    onClick={() => removeItem(item)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {item.status === 'ready' && (
                <Input
                  value={item.altText}
                  onChange={(event) => patchItem(item.localId, { altText: event.target.value })}
                  placeholder="Texto alternativo (acessibilidade)"
                  className="h-8 text-xs"
                  aria-label={`Texto alternativo para ${item.filename}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
