import type { SocialTokenResult } from '../types';

import { providerFetch } from './http';

export const META_GRAPH_VERSION = 'v21.0';
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const META_AUTHORIZE_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

export interface MetaCredentials {
  appId: string;
  appSecret: string;
}

interface MetaTokenResponse {
  access_token: string;
  expires_in?: number;
}

/** Troca `code` por token de curta duração e já promove para long-lived (~60 dias). */
export async function metaExchangeCodeForLongLivedToken(
  label: string,
  credentials: MetaCredentials,
  redirectUri: string,
  code: string,
  scopes: string[],
): Promise<SocialTokenResult> {
  const shortParams = new URLSearchParams({
    client_id: credentials.appId,
    client_secret: credentials.appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const shortLived = await providerFetch<MetaTokenResponse>(
    label,
    `${META_GRAPH_BASE}/oauth/access_token?${shortParams.toString()}`,
  );
  return metaExchangeForLongLived(label, credentials, shortLived.access_token, scopes);
}

/** Long-lived tokens da Meta são renovados repetindo o fb_exchange_token. */
export async function metaExchangeForLongLived(
  label: string,
  credentials: MetaCredentials,
  token: string,
  scopes: string[],
): Promise<SocialTokenResult> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: credentials.appId,
    client_secret: credentials.appSecret,
    fb_exchange_token: token,
  });
  const longLived = await providerFetch<MetaTokenResponse>(
    label,
    `${META_GRAPH_BASE}/oauth/access_token?${params.toString()}`,
  );
  return {
    accessToken: longLived.access_token,
    expiresAt: longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000)
      : undefined,
    scopes,
  };
}
