import { z } from 'zod';

export const upsertBankAccountSchema = z
  .object({
    accountHolderName: z.string().trim().min(2, 'Account holder name is required').max(150),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{8,30}$/, 'Account number must contain 8 to 30 digits'),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid 11-character IFSC code'),
    bankName: z.string().trim().min(2, 'Bank name is required').max(100),
    branchName: z.string().trim().max(150).optional(),
    accountType: z.enum(['SAVINGS', 'CURRENT', 'OTHER']).optional(),
    ownershipType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
    legalEntityName: z.string().trim().min(2).max(150).optional(),
    supportingDocumentId: z.string().uuid().optional(),
    upiId: z.string().trim().max(100).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.ownershipType === 'BUSINESS' && !input.legalEntityName) {
      context.addIssue({
        code: 'custom',
        path: ['legalEntityName'],
        message: 'Registered entity name is required for a business account',
      });
    }
  });

export type UpsertBankAccountInput = z.infer<typeof upsertBankAccountSchema>;
