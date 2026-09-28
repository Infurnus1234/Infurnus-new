import { z } from 'zod';

export const partnerDriverIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const partnerDriverStatusSchema = z
  .object({
    status: z.literal('INACTIVE'),
  })
  .strict();

export const partnerDriverListQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();

export type PartnerDriverListQuery = z.infer<typeof partnerDriverListQuerySchema>;
