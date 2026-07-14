import 'server-only';

import { cookies } from 'next/headers';

import type { AuthUser } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SESSION_COOKIE_NAME = 'sp_session';

/**
 * Server-side session check. `next/headers` cookies() only sees the incoming request's
 * cookies — it does NOT forward them to outgoing fetches automatically, so the session
 * cookie is attached to the `/auth/me` call by hand.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const sessionCookie = cookies().get(SESSION_COOKIE_NAME);
  if (!sessionCookie) return null;

  const response = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}` },
    cache: 'no-store',
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { user: AuthUser };
  return data.user;
}
