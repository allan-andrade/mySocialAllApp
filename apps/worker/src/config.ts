import type { ConnectionOptions } from 'bullmq';

export function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env['REDIS_URL'] ?? 'redis://localhost:6379';
}

/**
 * Parses REDIS_URL into a plain options object instead of constructing our own
 * `ioredis` instance, so BullMQ manages the connection with its own bundled
 * `ioredis` version — avoiding cross-version type conflicts between a direct
 * `ioredis` dependency and the one BullMQ ships internally.
 */
export function parseRedisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}

