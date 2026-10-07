import { z } from 'zod';

export const upsertBankAccountSchema = z
  .object({
    accountHolderName: z.string().trim().min(2, 'Account holder name is required').max(150),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{8,30}$/, 'Account number must contain 8 to 30 digits'),
    ifscCode: z.string().trim().min(4, 'IFSC code is required').max(20).toUpperCase(),
    bankName: z.string().trim().min(2, 'Bank name is required').max(100),
    upiId: z.string().trim().max(100).optional(),
  })
  .strict();

export type UpsertBankAccountInput = z.infer<typeof upsertBankAccountSchema>;
