import { z } from 'zod';

const partnerId = z.string().uuid();
const businessName = z.string().trim().min(1).max(150);
const businessDescription = z.string().trim().max(5000).optional();
const availabilityStatus = z.enum(['offline', 'available', 'unavailable']);

export const partnerIdSchema = z.object({ id: partnerId }).strict();

export const createPartnerSchema = z
  .object({
    userId: partnerId,
    businessName,
    businessDescription,
  })
  .strict();

export const updatePartnerSchema = z
  .object({
    businessName: businessName.optional(),
    businessDescription: z.string().trim().max(5000).nullable().optional(),
    availabilityStatus: availabilityStatus.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const partnerListQuerySchema = z
  .object({
    approvalStatus: z.enum(['pending', 'under_review', 'approved', 'rejected']).optional(),
    availabilityStatus: availabilityStatus.optional(),
  })
  .strict();

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;
export type PartnerListQuery = z.infer<typeof partnerListQuerySchema>;
