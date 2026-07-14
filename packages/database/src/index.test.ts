import { describe, expect, it } from 'vitest';

import { PrismaClient, prisma } from './index';

describe('database package', () => {
  it('exposes the generated PrismaClient and a cached singleton', () => {
    expect(PrismaClient).toBeTypeOf('function');
    expect(prisma).toBeInstanceOf(PrismaClient);
  });
});
