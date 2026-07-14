/** Providers implemented in the MVP. */
export type MvpSocialProvider = 'instagram' | 'threads' | 'x' | 'facebook_page';

/** Providers the connector architecture must be able to accommodate later, without rework. */
export type PlannedSocialProvider =
  | 'linkedin'
  | 'tiktok'
  | 'bluesky'
  | 'pinterest'
  | 'youtube_community'
  | 'mastodon';

export type SocialProvider = MvpSocialProvider | PlannedSocialProvider;

export const MVP_SOCIAL_PROVIDERS: readonly MvpSocialProvider[] = [
  'instagram',
  'threads',
  'x',
  'facebook_page',
];

// Mirrors the Prisma enum SocialConnectionStatus (uppercase, same values).
export type SocialConnectionStatus = 'CONNECTED' | 'EXPIRED' | 'REVOKED' | 'ERROR' | 'DISCONNECTED';
