import type { Pool } from 'pg';
import type { UpsertBankAccountInput } from '../schemas/provider.schemas.js';
import type { ProviderBankAccount } from '../types/provider.js';

export interface ProviderBankRepository {
  getBankAccount(userId: string): Promise<ProviderBankAccount | null>;
  upsertBankAccount(userId: string, input: UpsertBankAccountInput): Promise<ProviderBankAccount>;
}

export class PostgresProviderBankRepository implements ProviderBankRepository {
  constructor(private readonly pool: Pool) {}

  async getBankAccount(userId: string): Promise<ProviderBankAccount | null> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      account_holder_name: string;
      account_number_last4: string;
      ifsc_code: string;
      bank_name: string;
      upi_id: string | null;
      is_verified: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, account_holder_name, account_number_last4, ifsc_code,
              bank_name, upi_id, is_verified, created_at, updated_at
       FROM provider_bank_accounts
       WHERE user_id = $1`,
      [userId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      accountHolderName: row.account_holder_name,
      accountNumberMasked: `••••••••${row.account_number_last4}`,
      accountNumberLast4: row.account_number_last4,
      ifscCode: row.ifsc_code,
      bankName: row.bank_name,
      upiId: row.upi_id,
      isVerified: row.is_verified,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async upsertBankAccount(
    userId: string,
    input: UpsertBankAccountInput,
  ): Promise<ProviderBankAccount> {
    const last4 = input.accountNumber.slice(-4);
    const encrypted = Buffer.from(input.accountNumber, 'utf-8').toString('base64');

    const result = await this.pool.query<{
      id: string;
      user_id: string;
      account_holder_name: string;
      account_number_last4: string;
      ifsc_code: string;
      bank_name: string;
      upi_id: string | null;
      is_verified: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO provider_bank_accounts (
         user_id, account_holder_name, account_number_encrypted, account_number_last4,
         ifsc_code, bank_name, upi_id, is_verified, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         account_holder_name = EXCLUDED.account_holder_name,
         account_number_encrypted = EXCLUDED.account_number_encrypted,
         account_number_last4 = EXCLUDED.account_number_last4,
         ifsc_code = EXCLUDED.ifsc_code,
         bank_name = EXCLUDED.bank_name,
         upi_id = EXCLUDED.upi_id,
         is_verified = FALSE,
         updated_at = NOW()
       RETURNING id, user_id, account_holder_name, account_number_last4, ifsc_code,
                 bank_name, upi_id, is_verified, created_at, updated_at`,
      [
        userId,
        input.accountHolderName,
        encrypted,
        last4,
        input.ifscCode,
        input.bankName,
        input.upiId ?? null,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error('Failed to upsert bank account');

    return {
      id: row.id,
      userId: row.user_id,
      accountHolderName: row.account_holder_name,
      accountNumberMasked: `••••••••${row.account_number_last4}`,
      accountNumberLast4: row.account_number_last4,
      ifscCode: row.ifsc_code,
      bankName: row.bank_name,
      upiId: row.upi_id,
      isVerified: row.is_verified,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
