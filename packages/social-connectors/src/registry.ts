import { MVP_SOCIAL_PROVIDERS, type SocialProvider } from '@social-publisher/shared';

import { FakeConnector } from './fake/fake-connector';
import { FacebookPageConnector } from './live/facebook-page-connector';
import type { LiveConnectorOptions } from './live/http';
import { InstagramConnector } from './live/instagram-connector';
import type { MetaCredentials } from './live/meta-oauth';
import { ThreadsConnector, type ThreadsCredentials } from './live/threads-connector';
import { XConnector, type XCredentials } from './live/x-connector';
import type { SocialConnector } from './types';

export type ConnectorMode = 'mock' | 'live';

/**
 * Credenciais dos apps criados nos portais de desenvolvedores. Instagram e
 * Facebook Pages compartilham o app da Meta; Threads e X têm apps próprios.
 * Um provedor sem credenciais simplesmente não é registrado em modo live.
 */
export interface LiveConnectorConfig {
  meta?: MetaCredentials;
  threads?: ThreadsCredentials;
  x?: XCredentials;
  options?: LiveConnectorOptions;
}

export interface ConnectorRegistry {
  mode: ConnectorMode;
  get(provider: SocialProvider): SocialConnector;
  available(): SocialProvider[];
}

/** Monta a configuração live a partir das variáveis de ambiente (API e worker). */
export function liveConfigFromEnv(env: Record<string, string | undefined>): LiveConnectorConfig {
  const config: LiveConnectorConfig = {};
  if (env['META_APP_ID'] && env['META_APP_SECRET']) {
    config.meta = { appId: env['META_APP_ID'], appSecret: env['META_APP_SECRET'] };
  }
  if (env['THREADS_APP_ID'] && env['THREADS_APP_SECRET']) {
    config.threads = { appId: env['THREADS_APP_ID'], appSecret: env['THREADS_APP_SECRET'] };
  }
  if (env['X_CLIENT_ID']) {
    config.x = { clientId: env['X_CLIENT_ID'], clientSecret: env['X_CLIENT_SECRET'] };
  }
  return config;
}

/**
 * Cria o registry de conectores para o modo configurado (SOCIAL_CONNECTOR_MODE).
 *
 * - `mock`: fake connectors determinísticos para todos os provedores do MVP.
 * - `live`: registra apenas os conectores reais cujas credenciais existem.
 *   Provedor sem credencial falha explicitamente na obtenção — NUNCA cai
 *   para mock silenciosamente.
 */
export function createConnectorRegistry(
  mode: ConnectorMode,
  live: LiveConnectorConfig = {},
): ConnectorRegistry {
  const connectors = new Map<SocialProvider, SocialConnector>();

  if (mode === 'mock') {
    for (const provider of MVP_SOCIAL_PROVIDERS) {
      connectors.set(provider, new FakeConnector(provider));
    }
  } else {
    if (live.threads) {
      connectors.set('threads', new ThreadsConnector(live.threads, live.options));
    }
    if (live.meta) {
      connectors.set('instagram', new InstagramConnector(live.meta, live.options));
      connectors.set('facebook_page', new FacebookPageConnector(live.meta));
    }
    if (live.x) {
      connectors.set('x', new XConnector(live.x, live.options));
    }
  }

  return {
    mode,
    get(provider: SocialProvider): SocialConnector {
      const connector = connectors.get(provider);
      if (!connector) {
        throw new Error(
          mode === 'live'
            ? `Conector live de "${provider}" não está disponível: credenciais ausentes no ambiente ` +
              `(ver docs/oauth.md). Use SOCIAL_CONNECTOR_MODE=mock para desenvolvimento sem credenciais.`
            : `Provedor "${provider}" não faz parte do MVP.`,
        );
      }
      return connector;
    },
    available(): SocialProvider[] {
      return [...connectors.keys()];
    },
  };
}
