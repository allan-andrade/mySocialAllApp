import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from './errors';

describe('AppError', () => {
  it('carries code, http status and retryable flag', () => {
    const error = new AppError(ErrorCode.RATE_LIMITED, 'Too many requests', 429, true);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.httpStatus).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Too many requests');
  });

  it('defaults to a non-retryable 400', () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid input');

    expect(error.httpStatus).toBe(400);
    expect(error.retryable).toBe(false);
  });
});
