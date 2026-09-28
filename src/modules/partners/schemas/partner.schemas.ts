import { z } from 'zod';

const partnerId = z.string().uuid();

const businessName = z.string().trim().min(1).max(150);

const businessDescription = z.string().trim().max(5000).optional();

const ownerName = z.string().trim().min(1).max(150);

const providerType = z.string().trim().min(1).max(100);

const address = z.string().trim().min(1).max(500);

const city = z.string().trim().min(1).max(100);

const state = z.string().trim().min(1).max(100);

const pinCode = z.string().trim().min(1).max(20);

const numberOfVehicles = z.number().int().min(0);

const availabilityStatus = z.enum(['offline', 'available', 'unavailable']);

const approvalStatus = z.enum(['pending', 'under_review', 'approved', 'rejected']);

const approvalReviewReason = z.string().trim().max(1000).optional();

export const partnerIdSchema = z.object({ id: partnerId }).strict();

export const createPartnerSchema = z
  .object({
    userId: partnerId,
    businessName,
    businessDescription,
    ownerName: ownerName.optional(),
    providerType: providerType.optional(),
    address: address.optional(),
    city: city.optional(),
    state: state.optional(),
    pinCode: pinCode.optional(),
    numberOfVehicles: numberOfVehicles.optional(),
  })
  .strict();

export const updatePartnerSchema = z
  .object({
    businessName: businessName.optional(),

    businessDescription: z.string().trim().max(5000).nullable().optional(),

    ownerName: ownerName.nullable().optional(),

    providerType: providerType.nullable().optional(),

    address: address.nullable().optional(),

    city: city.nullable().optional(),

    state: state.nullable().optional(),

    pinCode: pinCode.nullable().optional(),

    numberOfVehicles: numberOfVehicles.nullable().optional(),

    availabilityStatus: availabilityStatus.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const updateAvailabilitySchema = z
  .object({
    availabilityStatus,
  })
  .strict();

export const partnerListQuerySchema = z
  .object({
    approvalStatus: approvalStatus.optional(),
    availabilityStatus: availabilityStatus.optional(),
  })
  .strict();

export const reviewPartnerSchema = z
  .object({
    status: z.enum(['under_review', 'approved', 'rejected']),
    reason: approvalReviewReason,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.status === 'rejected' && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Rejection reason is required when rejecting a partner.',
      });
    }
  });

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

export type PartnerListQuery = z.infer<typeof partnerListQuerySchema>;

export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

export type ReviewPartnerInput = z.infer<typeof reviewPartnerSchema>;
