'use client';

import type { ProviderValidationResult } from '@social-publisher/social-connectors';
import { Badge, Button, Card, CardContent, Switch, cn } from '@social-publisher/ui';
import Link from 'next/link';

import { PROVIDERS_META } from '../../lib/providers-meta';
import type { MvpProvider, SocialConnectionDto } from '../../lib/types';

export function PlatformToggleCard({
  provider,
  connection,
  enabled,
  onToggle,
  counter,
  validation,
  hasOverride,
  onCustomize,
  loadingConnections,
}: {
  provider: MvpProvider;
  connection: SocialConnectionDto | undefined;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  counter: { count: number; max: number | null };
  validation: ProviderValidationResult | undefined;
  hasOverride: boolean;
  onCustomize: () => void;
  loadingConnections: boolean;
}) {
  const meta = PROVIDERS_META[provider];
  const Icon = meta.icon;
  const isConnected = connection !== undefined;
  const invalid = enabled && validation !== undefined && !validation.valid;
  const overLimit = counter.max !== null && counter.count > counter.max;

  return (
    <Card className={cn(invalid && 'border-destructive')}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className={`h-5 w-5 shrink-0 ${meta.accentClass}`} aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{meta.name}</p>
              {isConnected ? (
                <p className="truncate text-xs text-muted-foreground">@{connection.username}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Não conectada</p>
              )}
            </div>
          </div>
          {isConnected ? (
            <Switch
              checked={enabled}
              onCheckedChange={onToggle}
              aria-label={`Publicar no ${meta.name}`}
            />
          ) : (
            <Button asChild variant="outline" size="sm" disabled={loadingConnections}>
              <Link href="/connections">Conectar</Link>
            </Button>
          )}
        </div>

        {isConnected && (
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'text-xs tabular-nums',
                overLimit ? 'font-semibold text-destructive' : 'text-muted-foreground',
              )}
            >
              {counter.count}
              {counter.max !== null && ` / ${counter.max}`}
            </span>
            <div className="flex items-center gap-2">
              {hasOverride && (
                <Badge variant="secondary" className="text-[10px]">
                  texto personalizado
                </Badge>
              )}
              {enabled &&
                (invalid ? (
                  <Badge variant="destructive">incompatível</Badge>
                ) : (
                  <Badge variant="success">compatível</Badge>
                ))}
            </div>
          </div>
        )}

        {invalid && validation && (
          <ul className="flex flex-col gap-1">
            {validation.errors.map((error) => (
              <li key={`${error.code}:${error.message}`} className="text-xs text-destructive" role="alert">
                {error.message}
              </li>
            ))}
          </ul>
        )}

        {isConnected && enabled && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCustomize}>
              {hasOverride ? 'Editar texto personalizado' : 'Personalizar texto'}
            </Button>
            {invalid && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onToggle(false)}
              >
                Desativar plataforma
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
