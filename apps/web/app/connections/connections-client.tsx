'use client';

import { useSearchParams } from 'next/navigation';

import { MockModeBanner } from '../../components/mock-mode-banner';
import { PROVIDER_ORDER, PROVIDERS_META } from '../../lib/providers-meta';
import { useConnections } from '../../lib/queries';

import { ProviderConnectionCard } from './provider-connection-card';

export function ConnectionsClient() {
  const { data, isLoading, error } = useConnections();
  const searchParams = useSearchParams();
  const connected = searchParams.get('connected');
  const callbackError = searchParams.get('error');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Conexões</h1>
        <p className="text-sm text-muted-foreground">
          Conecte as contas onde suas publicações serão enviadas.
        </p>
      </div>

      <MockModeBanner mode={data?.mode} />

      {connected && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Conta de {PROVIDERS_META[connected as keyof typeof PROVIDERS_META]?.name ?? connected}{' '}
          conectada com sucesso.
        </div>
      )}
      {callbackError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível concluir a conexão ({callbackError}). Tente novamente.
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          Erro ao carregar conexões: {error.message}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDER_ORDER.map((provider) => (
          <ProviderConnectionCard
            key={provider}
            meta={PROVIDERS_META[provider]}
            connection={data?.connections.find(
              (c) => c.provider === provider && c.status !== 'DISCONNECTED',
            )}
            loading={isLoading}
          />
        ))}
      </div>
    </div>
  );
}
