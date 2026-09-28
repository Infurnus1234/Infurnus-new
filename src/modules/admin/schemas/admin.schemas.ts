import { z } from 'zod';

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const dateRange = {
  from: z.string().date().optional(),
  to: z.string().date().optional(),
};

const documentStatus = z.enum(['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'EXPIRED']);

const complianceStatus = z.enum(['compliant', 'non_compliant', 'expiring', 'expired']);

export const adminIdSchema = z.object({ id: z.string().uuid() }).strict();

export const adminUsersQuerySchema = pagination
  .extend({
    search: z.string().trim().min(1).max(150).optional(),
    role: z.enum(['customer', 'driver', 'admin', 'super_admin']).optional(),
    status: z.enum(['active', 'suspended', 'banned']).optional(),
    ...dateRange,
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be on or before to',
  });

export const adminPartnersQuerySchema = pagination
  .extend({
    search: z.string().trim().min(1).max(150).optional(),
    approvalStatus: z.enum(['pending', 'under_review', 'approved', 'rejected']).optional(),
    availabilityStatus: z.enum(['offline', 'available', 'unavailable']).optional(),
    documentStatus: documentStatus.optional(),
    complianceStatus: complianceStatus.optional(),
    ...dateRange,
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be on or before to',
  });

export const adminVehiclesQuerySchema = pagination
  .extend({
    partnerId: z.string().uuid().optional(),
    active: z.coerce.boolean().optional(),
    plate: z.string().trim().min(1).max(20).optional(),
    make: z.string().trim().min(1).max(50).optional(),
    model: z.string().trim().min(1).max(50).optional(),
    documentStatus: documentStatus.optional(),
    complianceStatus: complianceStatus.optional(),
    ...dateRange,
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be on or before to',
  });

export const adminDriversQuerySchema = pagination
  .extend({
    search: z.string().trim().min(1).max(150).optional(),

    verificationStatus: z.enum(['pending', 'under_review', 'approved', 'rejected']).optional(),

    availabilityStatus: z.enum(['offline', 'available', 'unavailable']).optional(),

    partnerId: z.string().uuid().optional(),

    city: z.string().trim().min(1).max(100).optional(),

    state: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const adminDriverApplicationsQuerySchema = pagination
  .extend({
    search: z.string().trim().min(1).max(150).optional(),

    status: z
      .enum(['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'])
      .optional(),

    partnerId: z.string().uuid().optional(),

    requestedSector: z.string().trim().min(1).max(50).optional(),

    requestedVehicleCategory: z.string().trim().min(1).max(50).optional(),

    vehicleOwnershipType: z.string().trim().min(1).max(50).optional(),

    ...dateRange,
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be on or before to',
  });

export const fleetQuerySchema = pagination
  .extend({
    state: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    sector: z.enum(['passenger', 'logistics', 'service', 'premium']).optional(),
    category: z.string().trim().max(50).optional(),
    status: z.enum(['all', 'active', 'on_trip', 'offline', 'registered']).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

export const updateUserStatusSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'banned']),
  })
  .strict();

export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type AdminPartnersQuery = z.infer<typeof adminPartnersQuerySchema>;
export type AdminVehiclesQuery = z.infer<typeof adminVehiclesQuerySchema>;
export type AdminDriversQuery = z.infer<typeof adminDriversQuerySchema>;
export type AdminDriverApplicationsQuery = z.infer<typeof adminDriverApplicationsQuerySchema>;
export type FleetQuery = z.infer<typeof fleetQuerySchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const verifyDriverSchema = z
  .object({
    status: z.enum(['approved', 'rejected', 'pending', 'under_review']),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .strict();

export const reviewDriverApplicationSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
    reviewReason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.status === 'REJECTED' || value.status === 'CHANGES_REQUESTED') &&
      !value.reviewReason
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewReason'],
        message: 'reviewReason is required when rejecting or requesting changes',
      });
    }
  });

export const verifyVehicleSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .strict();

export const verifyDocumentSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED', 'PENDING', 'VERIFIED']),
    comments: z.string().trim().max(500).optional(),
  })
  .strict();

export type VerifyDriverInput = z.infer<typeof verifyDriverSchema>;
export type ReviewDriverApplicationInput = z.infer<typeof reviewDriverApplicationSchema>;
export type VerifyVehicleInput = z.infer<typeof verifyVehicleSchema>;
export type VerifyDocumentInput = z.infer<typeof verifyDocumentSchema>;
