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

export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type AdminPartnersQuery = z.infer<typeof adminPartnersQuerySchema>;
export type AdminVehiclesQuery = z.infer<typeof adminVehiclesQuerySchema>;
