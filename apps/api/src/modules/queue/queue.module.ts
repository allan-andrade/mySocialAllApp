import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PUBLICATION_TARGETS_QUEUE } from '@social-publisher/shared';
import { Queue } from 'bullmq';

export const PUBLICATION_TARGETS_QUEUE_TOKEN = Symbol('PUBLICATION_TARGETS_QUEUE');

function parseRedisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}

@Global()
@Module({
  providers: [
    {
      provide: PUBLICATION_TARGETS_QUEUE_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Queue(PUBLICATION_TARGETS_QUEUE, {
          connection: parseRedisConnection(config.getOrThrow<string>('REDIS_URL')),
        }),
    },
  ],
  exports: [PUBLICATION_TARGETS_QUEUE_TOKEN],
})
export class QueueModule {}
