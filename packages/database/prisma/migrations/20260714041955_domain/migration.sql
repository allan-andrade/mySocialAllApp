-- CreateEnum
CREATE TYPE "social_provider" AS ENUM ('instagram', 'threads', 'x', 'facebook_page', 'linkedin', 'tiktok', 'bluesky', 'pinterest', 'youtube_community', 'mastodon');

-- CreateEnum
CREATE TYPE "social_connection_status" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "facebook_page_connection_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "media_processing_status" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "publication_status" AS ENUM ('DRAFT', 'QUEUED', 'PROCESSING', 'PARTIALLY_PUBLISHED', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "publication_target_status" AS ENUM ('PENDING', 'VALIDATING', 'UPLOADING_MEDIA', 'CREATING_CONTAINER', 'WAITING_PROCESSING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'RETRY_SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "publication_attempt_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "social_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "social_provider" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalAccountName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "accountType" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "social_connection_status" NOT NULL DEFAULT 'CONNECTED',
    "capabilities" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_page_connections" (
    "id" TEXT NOT NULL,
    "socialConnectionId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL,
    "pageAvatarUrl" TEXT,
    "encryptedPageAccessToken" TEXT,
    "status" "facebook_page_connection_status" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facebook_page_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "checksum" TEXT,
    "processingStatus" "media_processing_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "selectedProviders" "social_provider"[],
    "providerOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "draftId" TEXT,
    "baseText" TEXT NOT NULL DEFAULT '',
    "status" "publication_status" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_media" (
    "publicationId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "altText" TEXT,

    CONSTRAINT "publication_media_pkey" PRIMARY KEY ("publicationId","position")
);

-- CreateTable
CREATE TABLE "publication_targets" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "socialConnectionId" TEXT NOT NULL,
    "facebookPageConnectionId" TEXT,
    "provider" "social_provider" NOT NULL,
    "customText" TEXT,
    "status" "publication_target_status" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "externalPublicationId" TEXT,
    "externalUrl" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publication_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_attempts" (
    "id" TEXT NOT NULL,
    "publicationTargetId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "publication_attempt_status" NOT NULL DEFAULT 'RUNNING',
    "providerHttpStatus" INTEGER,
    "normalizedErrorCode" TEXT,
    "normalizedErrorMessage" TEXT,
    "sanitizedResponse" JSONB,
    "requestCorrelationId" TEXT,

    CONSTRAINT "publication_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_connections_userId_idx" ON "social_connections"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_userId_provider_externalAccountId_key" ON "social_connections"("userId", "provider", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_page_connections_socialConnectionId_pageId_key" ON "facebook_page_connections"("socialConnectionId", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "media_assets_userId_idx" ON "media_assets"("userId");

-- CreateIndex
CREATE INDEX "drafts_userId_updatedAt_idx" ON "drafts"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "publications_userId_createdAt_idx" ON "publications"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "publications_userId_idempotencyKey_key" ON "publications"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "publication_media_publicationId_mediaAssetId_key" ON "publication_media"("publicationId", "mediaAssetId");

-- CreateIndex
CREATE INDEX "publication_targets_publicationId_idx" ON "publication_targets"("publicationId");

-- CreateIndex
CREATE INDEX "publication_targets_socialConnectionId_idx" ON "publication_targets"("socialConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "publication_targets_publicationId_socialConnectionId_revisi_key" ON "publication_targets"("publicationId", "socialConnectionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "publication_attempts_publicationTargetId_attemptNumber_key" ON "publication_attempts"("publicationTargetId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_page_connections" ADD CONSTRAINT "facebook_page_connections_socialConnectionId_fkey" FOREIGN KEY ("socialConnectionId") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_targets" ADD CONSTRAINT "publication_targets_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_targets" ADD CONSTRAINT "publication_targets_socialConnectionId_fkey" FOREIGN KEY ("socialConnectionId") REFERENCES "social_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_targets" ADD CONSTRAINT "publication_targets_facebookPageConnectionId_fkey" FOREIGN KEY ("facebookPageConnectionId") REFERENCES "facebook_page_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_publicationTargetId_fkey" FOREIGN KEY ("publicationTargetId") REFERENCES "publication_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
