import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTokenCipherFromEnv, type TokenCipher } from '@social-publisher/crypto';
import {
  createConnectorRegistry,
  liveConfigFromEnv,
  type ConnectorMode,
  type ConnectorRegistry,
} from '@social-publisher/social-connectors';

export const CONNECTOR_REGISTRY = Symbol('CONNECTOR_REGISTRY');
export const TOKEN_CIPHER = Symbol('TOKEN_CIPHER');

@Global()
@Module({
  providers: [
    {
      provide: CONNECTOR_REGISTRY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ConnectorRegistry => {
        const logger = new Logger('Connectors');
        const mode = config.getOrThrow<ConnectorMode>('SOCIAL_CONNECTOR_MODE');
        const registry = createConnectorRegistry(
          mode,
          mode === 'live' ? liveConfigFromEnv(process.env) : {},
        );
        logger.log(
          `Modo ${mode.toUpperCase()} — conectores disponíveis: ${registry.available().join(', ') || 'nenhum'}`,
        );
        if (mode === 'live') {
          const missing = ['instagram', 'threads', 'x', 'facebook_page'].filter(
            (p) => !registry.available().includes(p as never),
          );
          if (missing.length > 0) {
            logger.warn(
              `Sem credenciais para: ${missing.join(', ')} — esses conectores ficam desabilitados (ver docs/oauth.md).`,
            );
          }
        }
        return registry;
      },
    },
    {
      provide: TOKEN_CIPHER,
      useFactory: (): TokenCipher => createTokenCipherFromEnv(),
    },
  ],
  exports: [CONNECTOR_REGISTRY, TOKEN_CIPHER],
})
export class ConnectorsModule {}
