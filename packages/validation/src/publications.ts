import { z } from 'zod';

import { mvpProviderSchema } from './providers';

export const validatePublicationSchema = z.object({
  text: z.string().max(10_000).default(''),
  providers: z.array(mvpProviderSchema).min(1, 'Selecione ao menos uma plataforma.'),
  providerOverrides: z
    .record(mvpProviderSchema, z.object({ text: z.string().max(10_000) }))
    .optional(),
  media: z
    .array(
      z.object({
        mimeType: z.string().min(1),
        sizeBytes: z.number().int().positive().optional(),
        durationSeconds: z.number().positive().optional(),
      }),
    )
    .default([]),
});

export type ValidatePublicationInput = z.infer<typeof validatePublicationSchema>;

export const createPublicationSchema = z.object({
  text: z.string().max(10_000).default(''),
  providers: z.array(mvpProviderSchema).min(1, 'Selecione ao menos uma plataforma.'),
  providerOverrides: z
    .record(mvpProviderSchema, z.object({ text: z.string().max(10_000) }))
    .optional(),
  media: z
    .array(
      z.object({
        mediaAssetId: z.string().uuid(),
        altText: z.string().max(1000).optional(),
      }),
    )
    .max(20)
    .default([]),
  // Gerada no cliente uma única vez por composição; repetir a requisição
  // (timeout, clique duplo) reaproveita a mesma publicação.
  idempotencyKey: z.string().min(8).max(100),
  draftId: z.string().uuid().optional(),
});

export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;
