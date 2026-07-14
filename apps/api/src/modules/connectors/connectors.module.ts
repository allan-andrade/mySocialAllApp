import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTokenCipherFromEnv, type TokenCipher } from '@social-publisher/crypto';
import {
  createConnectorRegistry,
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
      useFactory: (config: ConfigService): ConnectorRegistry =>
        createConnectorRegistry(config.getOrThrow<ConnectorMode>('SOCIAL_CONNECTOR_MODE')),
    },
    {
      provide: TOKEN_CIPHER,
      useFactory: (): TokenCipher => createTokenCipherFromEnv(),
    },
  ],
  exports: [CONNECTOR_REGISTRY, TOKEN_CIPHER],
})
export class ConnectorsModule {}
