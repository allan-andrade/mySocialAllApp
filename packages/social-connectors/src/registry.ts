import { MVP_SOCIAL_PROVIDERS, type SocialProvider } from '@social-publisher/shared';

import { FakeConnector } from './fake/fake-connector';
import type { SocialConnector } from './types';

export type ConnectorMode = 'mock' | 'live';

export interface ConnectorRegistry {
  mode: ConnectorMode;
  get(provider: SocialProvider): SocialConnector;
  available(): SocialProvider[];
}

/**
 * Cria o registry de conectores para o modo configurado (SOCIAL_CONNECTOR_MODE).
 *
 * - `mock`: fake connectors determinísticos para todos os provedores do MVP.
 * - `live`: exige implementações reais (Fase 5). Enquanto não existirem, o provedor
 *   falha explicitamente na obtenção — NUNCA cai para mock silenciosamente.
 */
export function createConnectorRegistry(mode: ConnectorMode): ConnectorRegistry {
  const connectors = new Map<SocialProvider, SocialConnector>();

  if (mode === 'mock') {
    for (const provider of MVP_SOCIAL_PROVIDERS) {
      connectors.set(provider, new FakeConnector(provider));
    }
  }
  // mode === 'live': os conectores reais serão registrados aqui na Fase 5,
  // cada um condicionado à presença das suas credenciais no ambiente.

  return {
    mode,
    get(provider: SocialProvider): SocialConnector {
      const connector = connectors.get(provider);
      if (!connector) {
        throw new Error(
          mode === 'live'
            ? `Conector live de "${provider}" não está disponível (implementação real chega na Fase 5 ` +
              `e exige credenciais). Use SOCIAL_CONNECTOR_MODE=mock para desenvolvimento.`
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
