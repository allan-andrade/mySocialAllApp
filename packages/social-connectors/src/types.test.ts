import { describe, expect, it } from 'vitest';

import type { SocialConnector } from './types';

describe('SocialConnector contract', () => {
  it('is implementable with a minimal fake, proving the interface is well-formed', async () => {
    const fake: SocialConnector = {
      provider: 'threads',
      getAuthorizationUrl: async () => 'https://mock.local/authorize',
      exchangeAuthorizationCode: async () => ({ accessToken: 'token', scopes: [] }),
      refreshAccessToken: async () => ({ accessToken: 'token', scopes: [] }),
      revokeConnection: async () => undefined,
      getProfile: async () => ({
        externalAccountId: '123',
        username: 'mock',
        displayName: 'Mock Account',
      }),
      getCapabilities: async () => ({
        text: { supported: true, maxCharacters: 500, countingStrategy: 'unicode-code-points' },
        media: {
          imageSupported: true,
          videoSupported: true,
          carouselSupported: true,
          textOnlySupported: true,
          maxItems: 10,
          maxImages: 10,
          maxVideos: 10,
          allowMixedMedia: true,
          acceptedMimeTypes: ['image/jpeg'],
          maxFileSizeBytes: 8_000_000,
          maxVideoDurationSeconds: 300,
        },
      }),
      validatePost: async () => ({ valid: true, errors: [] }),
      publish: async () => ({ externalPublicationId: 'mock-1' }),
    };

    await expect(fake.getAuthorizationUrl({ userId: 'u1', redirectUri: 'https://x' })).resolves.toContain(
      'mock.local',
    );
    expect(fake.provider).toBe('threads');
  });
});
