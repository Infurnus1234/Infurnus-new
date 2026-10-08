import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '../../../common/crypto/encryption.js';
import { PostgresProviderBankRepository } from '../repositories/provider-bank.repository.js';
import { upsertBankAccountSchema } from '../schemas/provider.schemas.js';

describe('Provider banking privacy', () => {
  const input = {
    accountHolderName: 'Test Provider',
    accountNumber: '123456789012',
    ifscCode: 'TEST0001234',
    bankName: 'Test Bank',
  };

  it('stores authenticated ciphertext and returns only masked account data', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'bank-id',
          user_id: 'owner-id',
          account_holder_name: input.accountHolderName,
          account_number_last4: '9012',
          ifsc_code: input.ifscCode,
          bank_name: input.bankName,
          upi_id: null,
          is_verified: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });
    const repository = new PostgresProviderBankRepository({ query } as unknown as Pool);
    const result = await repository.upsertBankAccount('owner-id', input);
    const ciphertext = query.mock.calls[0]![1][2] as string;
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain(input.accountNumber);
    expect(decryptSecret(ciphertext)).toBe(input.accountNumber);
    expect(result.accountNumberMasked).toBe('••••••••9012');
    expect(result).not.toHaveProperty('accountNumber');
    expect(result).not.toHaveProperty('accountNumberEncrypted');
    expect(query.mock.calls[0]![0]).toContain('is_verified = FALSE');
  });

  it.each(['abcdefgh', '1234567', '1234 5678', '1'.repeat(31)])(
    'rejects invalid account number %s',
    (accountNumber) => {
      expect(upsertBankAccountSchema.safeParse({ ...input, accountNumber }).success).toBe(false);
    },
  );
});
