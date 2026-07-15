import type { SocialConnectionStatus, SocialProvider } from '@social-publisher/shared';

/**
 * Placeholder shape for a persisted connection. Phase 2 replaces this with the type
 * derived from the Prisma `SocialConnection` model once the full domain schema lands;
 * connectors are coded against this contract in the meantime so implementations can
 * start without waiting on the ORM layer.
 */
export interface SocialConnection {
  id: string;
  userId: string;
  provider: SocialProvider;
  externalAccountId: string;
  accountType?: string;
  status: SocialConnectionStatus;
  /**
   * Token de acesso JÁ descriptografado, fornecido pelo chamador (API/worker) no
   * momento da chamada. Nunca é persistido nesta forma — em repouso os tokens
   * vivem cifrados no banco (AES-256-GCM).
   */
  accessToken?: string;
  refreshToken?: string;
  /** Destino filho quando aplicável (Facebook: Página administrada + page token). */
  page?: {
    pageId: string;
    pageName?: string;
    accessToken?: string;
  };
}

export interface AuthorizationInput {
  userId: string;
  redirectUri: string;
}

export interface AuthorizationCodeInput {
  code: string;
  state: string;
  redirectUri: string;
  /** Present for providers using OAuth 2.0 Authorization Code + PKCE (e.g. X). */
  codeVerifier?: string;
}

export interface SocialTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

export interface SocialProfile {
  externalAccountId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  accountType?: string;
}

export interface ProviderCapabilities {
  text: {
    supported: boolean;
    maxCharacters: number | null;
    countingStrategy: 'simple' | 'unicode-code-points' | 'x-weighted';
  };
  media: {
    imageSupported: boolean;
    videoSupported: boolean;
    carouselSupported: boolean;
    textOnlySupported: boolean;
    /** Limite combinado de mídias (imagens + vídeos contam para o mesmo total). */
    maxItems: number | null;
    /** Limite específico de imagens; `null` = usa apenas o limite combinado. */
    maxImages: number | null;
    /** Limite específico de vídeos (ex.: X aceita só 1 vídeo por publicação). */
    maxVideos: number | null;
    /** Se `false`, imagens e vídeos não podem coexistir no mesmo post (ex.: X). */
    allowMixedMedia: boolean;
    acceptedMimeTypes: string[];
    maxFileSizeBytes: number | null;
    maxVideoDurationSeconds: number | null;
  };
}

export interface ProviderPostMediaInput {
  url: string;
  mimeType: string;
  altText?: string;
}

export interface ProviderPostInput {
  text: string;
  media: ProviderPostMediaInput[];
}

export interface ProviderValidationError {
  code: string;
  message: string;
}

export interface ProviderValidationResult {
  valid: boolean;
  errors: ProviderValidationError[];
  characterCount?: number;
  maxCharacters?: number | null;
}

export interface ProviderPublishResult {
  externalPublicationId: string;
  externalUrl?: string;
}

export interface ProviderPublishStatus {
  status: 'processing' | 'published' | 'failed';
  externalUrl?: string;
}

/** Destino filho de uma conexão (ex.: Página do Facebook administrada pelo usuário). */
export interface ProviderPage {
  pageId: string;
  pageName: string;
  pageAvatarUrl?: string;
  /**
   * Page access token retornado pelo provedor. O consumidor (API) deve cifrá-lo
   * antes de persistir e NUNCA expô-lo em respostas HTTP.
   */
  pageAccessToken?: string;
}

/**
 * Contract every provider integration must implement. No platform-specific rule may
 * live outside a connector — controllers, UI components and generic services stay
 * provider-agnostic and only talk to this interface.
 */
export interface SocialConnector {
  provider: SocialProvider;

  getAuthorizationUrl(input: AuthorizationInput): Promise<string>;

  exchangeAuthorizationCode(input: AuthorizationCodeInput): Promise<SocialTokenResult>;

  refreshAccessToken(connection: SocialConnection): Promise<SocialTokenResult>;

  revokeConnection(connection: SocialConnection): Promise<void>;

  getProfile(connection: SocialConnection): Promise<SocialProfile>;

  getCapabilities(connection: SocialConnection): Promise<ProviderCapabilities>;

  validatePost(
    input: ProviderPostInput,
    capabilities: ProviderCapabilities,
  ): Promise<ProviderValidationResult>;

  publish(input: ProviderPostInput, connection: SocialConnection): Promise<ProviderPublishResult>;

  getPublishStatus?(
    externalPublicationId: string,
    connection: SocialConnection,
  ): Promise<ProviderPublishStatus>;

  /** Só para provedores com destinos filhos (Facebook: Páginas administradas). */
  listPages?(connection: SocialConnection): Promise<ProviderPage[]>;
}
