/**
 * Internal error codes, independent of any social provider's own error format.
 * Connectors (packages/social-connectors) must translate provider errors into these.
 */
export enum ErrorCode {
  AUTHORIZATION_REQUIRED = 'AUTHORIZATION_REQUIRED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  INSUFFICIENT_PERMISSION = 'INSUFFICIENT_PERMISSION',
  ACCOUNT_NOT_SUPPORTED = 'ACCOUNT_NOT_SUPPORTED',
  TEXT_TOO_LONG = 'TEXT_TOO_LONG',
  TEXT_REQUIRED = 'TEXT_REQUIRED',
  MEDIA_REQUIRED = 'MEDIA_REQUIRED',
  MEDIA_NOT_SUPPORTED = 'MEDIA_NOT_SUPPORTED',
  MEDIA_TOO_LARGE = 'MEDIA_TOO_LARGE',
  MEDIA_TOO_MANY = 'MEDIA_TOO_MANY',
  MEDIA_DURATION_EXCEEDED = 'MEDIA_DURATION_EXCEEDED',
  MEDIA_PROCESSING_FAILED = 'MEDIA_PROCESSING_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_REJECTED_CONTENT = 'PROVIDER_REJECTED_CONTENT',
  PUBLICATION_NOT_FOUND = 'PUBLICATION_NOT_FOUND',
  DUPLICATE_PUBLICATION = 'DUPLICATE_PUBLICATION',
  UNKNOWN_PROVIDER_ERROR = 'UNKNOWN_PROVIDER_ERROR',
  // Generic application-level codes (auth, validation) used ahead of the provider layer.
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_IN_USE = 'EMAIL_ALREADY_IN_USE',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, httpStatus = 400, retryable = false) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}
