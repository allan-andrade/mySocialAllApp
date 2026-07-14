import { z } from 'zod';

/** União dos formatos aceitos por qualquer provedor do MVP; o backend revalida por política. */
export const ACCEPTED_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
] as const;

export const MAX_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB (teto global; políticas afinam por provedor)

export const presignedUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ACCEPTED_UPLOAD_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
});

export const completeUploadSchema = z.object({
  mediaAssetId: z.string().uuid(),
  // Metadados medidos no cliente — melhor esforço até o pipeline com ffprobe (Fase 6).
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),
});

export type PresignedUploadInput = z.infer<typeof presignedUploadSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;
