import { z } from 'zod';

export const upsertBankAccountSchema = z
  .object({
    accountHolderName: z.string().trim().min(2, 'Account holder name is required').max(150),
    accountNumber: z.string().trim().min(8, 'Account number must be at least 8 digits').max(30),
    ifscCode: z.string().trim().min(4, 'IFSC code is required').max(20).toUpperCase(),
    bankName: z.string().trim().min(2, 'Bank name is required').max(100),
    upiId: z.string().trim().max(100).optional(),
  })
  .strict();

export type UpsertBankAccountInput = z.infer<typeof upsertBankAccountSchema>;
