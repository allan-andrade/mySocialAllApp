import { describe, expect, it } from 'vitest';

import { resolveRedisUrl } from './config';

describe('resolveRedisUrl', () => {
  it('falls back to the local default when REDIS_URL is unset', () => {
    expect(resolveRedisUrl({})).toBe('redis://localhost:6379');
  });

  it('uses REDIS_URL when present', () => {
    expect(resolveRedisUrl({ REDIS_URL: 'redis://redis:6379' })).toBe('redis://redis:6379');
  });
});
