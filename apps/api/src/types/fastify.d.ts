import type { PublicUser } from '../modules/auth/session.util';

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
  }
}
