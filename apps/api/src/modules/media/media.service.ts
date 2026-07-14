import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { MediaAsset } from '@social-publisher/database';
import { AppError, ErrorCode } from '@social-publisher/shared';
import type { CompleteUploadInput, PresignedUploadInput } from '@social-publisher/validation';

import { PrismaService } from '../prisma/prisma.service';

import { MAGIC_HEADER_LENGTH, matchesDeclaredMime } from './magic-bytes';
import { S3Service } from './s3.service';

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

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async createPresignedUpload(userId: string, input: PresignedUploadInput) {
    // storageKey opaco e sempre derivado no servidor — o nome do arquivo do cliente
    // nunca vira caminho (sem path traversal).
    const storageKey = `users/${userId}/${randomUUID()}`;

    const asset = await this.prisma.mediaAsset.create({
      data: {
        userId,
        storageKey,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        processingStatus: 'PENDING_UPLOAD',
      },
    });

    const uploadUrl = await this.s3.presignPut(storageKey, input.mimeType, input.sizeBytes);
    return { mediaAssetId: asset.id, uploadUrl, expiresInSeconds: 600 };
  }

  async completeUpload(userId: string, input: CompleteUploadInput): Promise<MediaAssetDto> {
    const asset = await this.requireOwned(userId, input.mediaAssetId);
    if (asset.processingStatus === 'READY') {
      return this.toDto(asset); // idempotente
    }

    const head = await this.s3.head(asset.storageKey);
    if (!head) {
      throw new AppError(
        ErrorCode.MEDIA_PROCESSING_FAILED,
        'Arquivo não encontrado no armazenamento. Refaça o upload.',
        400,
      );
    }
    if (head.sizeBytes !== asset.sizeBytes) {
      await this.markFailed(asset.id);
      throw new AppError(
        ErrorCode.MEDIA_PROCESSING_FAILED,
        'Tamanho do arquivo difere do declarado no início do upload.',
        400,
      );
    }

    const header = await this.s3.readRange(asset.storageKey, MAGIC_HEADER_LENGTH);
    if (!header || !matchesDeclaredMime(header, asset.mimeType)) {
      await this.markFailed(asset.id);
      await this.s3.delete(asset.storageKey);
      throw new AppError(
        ErrorCode.MEDIA_NOT_SUPPORTED,
        'O conteúdo do arquivo não corresponde ao formato declarado.',
        400,
      );
    }

    const updated = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        processingStatus: 'READY',
        checksum: head.etag ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        durationSeconds: input.durationSeconds ?? null,
      },
    });
    return this.toDto(updated);
  }

  async get(userId: string, id: string): Promise<MediaAssetDto> {
    const asset = await this.requireOwned(userId, id);
    return this.toDto(asset);
  }

  async remove(userId: string, id: string): Promise<void> {
    const asset = await this.requireOwned(userId, id);
    const references = await this.prisma.publicationMedia.count({
      where: { mediaAssetId: asset.id },
    });
    if (references > 0) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Esta mídia pertence a uma publicação e não pode ser excluída.',
        409,
      );
    }
    await this.s3.delete(asset.storageKey);
    await this.prisma.mediaAsset.delete({ where: { id: asset.id } });
  }

  /** URL de leitura temporária para um asset já validado (previews, histórico, provedores). */
  presignedUrlFor(asset: Pick<MediaAsset, 'storageKey'>): Promise<string> {
    return this.s3.presignGet(asset.storageKey);
  }

  private async toDto(asset: MediaAsset): Promise<MediaAssetDto> {
    return {
      id: asset.id,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      processingStatus: asset.processingStatus,
      url: asset.processingStatus === 'READY' ? await this.s3.presignGet(asset.storageKey) : null,
      createdAt: asset.createdAt.toISOString(),
    };
  }

  private async requireOwned(userId: string, id: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset || asset.userId !== userId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Mídia não encontrada.', 404);
    }
    return asset;
  }

  private markFailed(id: string) {
    return this.prisma.mediaAsset.update({
      where: { id },
      data: { processingStatus: 'FAILED' },
    });
  }
}
