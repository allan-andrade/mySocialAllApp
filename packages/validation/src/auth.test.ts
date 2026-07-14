import { describe, expect, it } from 'vitest';

import { loginSchema, registerSchema } from './auth';

describe('registerSchema', () => {
  it('accepts a valid payload', () => {
    const result = registerSchema.safeParse({
      name: 'Allan Andrade',
      email: 'Allan@Example.com',
      password: 'supersecret123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('allan@example.com');
    }
  });

  it('rejects a short password', () => {
    const result = registerSchema.safeParse({
      name: 'Allan',
      email: 'allan@example.com',
      password: '1234567',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = registerSchema.safeParse({
      name: 'Allan',
      email: 'not-an-email',
      password: 'supersecret123',
    });

    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('requires a non-empty password', () => {
    const result = loginSchema.safeParse({ email: 'allan@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});
