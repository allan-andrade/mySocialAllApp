import { PrismaClient } from '@prisma/client';

export { PrismaClient } from '@prisma/client';
export {
  SocialProvider,
  SocialConnectionStatus,
  FacebookPageConnectionStatus,
  MediaProcessingStatus,
  PublicationStatus,
  PublicationTargetStatus,
  PublicationAttemptStatus,
} from '@prisma/client';
export type {
  User,
  Session,
  SocialConnection,
  FacebookPageConnection,
  MediaAsset,
  Draft,
  Publication,
  PublicationMedia,
  PublicationTarget,
  PublicationAttempt,
  Prisma,
} from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

/**
 * Singleton for scripts/workers that don't manage their own DI lifecycle.
 * NestJS should NOT use this directly — it wraps `PrismaClient` in its own
 * `PrismaService` so `onModuleInit`/`onModuleDestroy` control the connection.
 * Cached on `globalThis` to survive tsc --watch / hot-reload without exhausting
 * Postgres connections in local dev.
 */
export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__prisma = prisma;
}
