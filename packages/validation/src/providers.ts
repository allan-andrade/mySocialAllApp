import { z } from 'zod';

export const mvpProviderSchema = z.enum(['instagram', 'threads', 'x', 'facebook_page']);

export type MvpProviderInput = z.infer<typeof mvpProviderSchema>;
