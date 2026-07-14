'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  cn,
} from '@social-publisher/ui';
import { useState } from 'react';

import { countForProvider } from '../../lib/composer-logic';
import { PROVIDERS_META } from '../../lib/providers-meta';
import type { MvpProvider } from '../../lib/types';

export function CustomTextDialog({
  provider,
  baseText,
  currentOverride,
  onSave,
  onClose,
}: {
  provider: MvpProvider;
  baseText: string;
  currentOverride: string | undefined;
  onSave: (value: string | undefined) => void;
  onClose: () => void;
}) {
  const meta = PROVIDERS_META[provider];
  const [value, setValue] = useState(currentOverride ?? baseText);
  const counter = countForProvider(provider, value, {});
  const overLimit = counter.max !== null && counter.count > counter.max;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Texto personalizado — {meta.name}</DialogTitle>
          <DialogDescription>
            Esta versão será usada somente no {meta.name}. As demais plataformas continuam com o
            texto principal.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-[140px]"
            aria-label={`Texto personalizado para ${meta.name}`}
          />
          <span
            className={cn(
              'self-end text-xs tabular-nums',
              overLimit ? 'font-semibold text-destructive' : 'text-muted-foreground',
            )}
          >
            {counter.count}
            {counter.max !== null && ` / ${counter.max}`}
          </span>
        </div>

        <DialogFooter>
          {currentOverride !== undefined && (
            <Button variant="ghost" onClick={() => onSave(undefined)}>
              Remover personalização
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(value)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
