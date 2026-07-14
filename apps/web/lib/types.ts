export interface AuthUser {
  id: string;
  name: string;
  email: string;
  imageUrl: string | null;
  createdAt: string;
}

export type MvpProvider = 'instagram' | 'threads' | 'x' | 'facebook_page';

export interface FacebookPageDto {
  id: string;
  pageId: string;
  pageName: string;
  pageAvatarUrl: string | null;
  status: string;
}

export interface SocialConnectionDto {
  id: string;
  provider: MvpProvider;
  externalAccountName: string;
  username: string;
  avatarUrl: string | null;
  accountType: string | null;
  status: 'CONNECTED' | 'EXPIRED' | 'REVOKED' | 'ERROR' | 'DISCONNECTED';
  scopes: string[];
  tokenExpiresAt: string | null;
  createdAt: string;
  facebookPages: FacebookPageDto[];
}

export interface ConnectionsResponse {
  mode: 'mock' | 'live';
  connections: SocialConnectionDto[];
}

export interface ProviderPageDto {
  pageId: string;
  pageName: string;
  pageAvatarUrl?: string;
}

export interface MediaAssetDto {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  processingStatus: string;
  url: string | null;
  createdAt: string;
}

export interface DraftDto {
  id: string;
  text: string;
  selectedProviders: MvpProvider[];
  providerOverrides: Partial<Record<MvpProvider, { text: string }>> | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface PublicationTargetDto {
  id: string;
  provider: MvpProvider;
  username: string;
  pageName: string | null;
  customText: string | null;
  status: PublicationTargetStatus;
  attemptCount: number;
  externalUrl: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryable: boolean;
  publishedAt: string | null;
}

export interface PublicationMediaDto {
  mediaAssetId: string;
  position: number;
  altText: string | null;
  mimeType: string;
  url: string | null;
}

export interface PublicationDto {
  id: string;
  baseText: string;
  status: PublicationStatus;
  createdAt: string;
  publishedAt: string | null;
  targets: PublicationTargetDto[];
  media: PublicationMediaDto[];
}

export interface PublicationListResponse {
  items: PublicationDto[];
  nextCursor: string | null;
}
