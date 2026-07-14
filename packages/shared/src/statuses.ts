/**
 * String-literal mirrors of the Prisma enums (packages/database/prisma/schema.prisma).
 * The frontend consumes these instead of importing @prisma/client, which must never
 * reach a browser bundle. Values must stay in sync with the schema.
 */

export type PublicationStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'PROCESSING'
  | 'PARTIALLY_PUBLISHED'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELLED';

export type PublicationTargetStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'UPLOADING_MEDIA'
  | 'CREATING_CONTAINER'
  | 'WAITING_PROCESSING'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'RETRY_SCHEDULED'
  | 'CANCELLED';

export type PublicationAttemptStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type MediaProcessingStatus =
  | 'PENDING_UPLOAD'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED';

export type FacebookPageConnectionStatus = 'ACTIVE' | 'DISABLED';
