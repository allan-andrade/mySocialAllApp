import { createHash, randomBytes } from 'node:crypto';

import type { User } from '@social-publisher/database';

export const SESSION_COOKIE_NAME = 'sp_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  imageUrl: string | null;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    createdAt: user.createdAt,
  };
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
