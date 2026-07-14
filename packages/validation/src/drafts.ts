import { z } from 'zod';

import { mvpProviderSchema } from './providers';

const providerOverridesSchema = z.record(
  mvpProviderSchema,
  z.object({ text: z.string().max(10_000) }),
);

export const createDraftSchema = z.object({
  text: z.string().max(10_000).default(''),
  selectedProviders: z.array(mvpProviderSchema).default([]),
  providerOverrides: providerOverridesSchema.optional(),
});

export const updateDraftSchema = z.object({
  text: z.string().max(10_000).optional(),
  selectedProviders: z.array(mvpProviderSchema).optional(),
  providerOverrides: providerOverridesSchema.nullish(),
});

export type CreateDraftInput = z.infer<typeof createDraftSchema>;
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
