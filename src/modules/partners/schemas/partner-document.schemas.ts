import { z } from 'zod';
import { partnerDocumentTypes } from '../types/partner-document.js';

const documentStatus = z.enum(['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'EXPIRED']);
const date = z.string().date();
const metadata = z.record(z.string(), z.unknown()).nullable().optional();

export const partnerDocumentIdSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
  })
  .strict();

export const createPartnerDocumentSchema = z
  .object({
    vehicleId: z.string().uuid().nullable().optional(),
    documentType: z.enum(partnerDocumentTypes),
    status: documentStatus.optional(),
    metadata,
    issuedAt: date.nullable().optional(),
    expiresAt: date.nullable().optional(),
  })
  .strict()
  .refine((value) => !value.issuedAt || !value.expiresAt || value.expiresAt >= value.issuedAt, {
    message: 'expiresAt must be on or after issuedAt',
  });

export const updatePartnerDocumentSchema = z
  .object({
    status: documentStatus.optional(),
    metadata,
    issuedAt: date.nullable().optional(),
    expiresAt: date.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })
  .refine((value) => !value.issuedAt || !value.expiresAt || value.expiresAt >= value.issuedAt, {
    message: 'expiresAt must be on or after issuedAt',
  });

export type CreatePartnerDocumentInput = z.infer<typeof createPartnerDocumentSchema>;
export type UpdatePartnerDocumentInput = z.infer<typeof updatePartnerDocumentSchema>;
