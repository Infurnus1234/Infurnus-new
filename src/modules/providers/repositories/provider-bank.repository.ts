import { AppError } from '../../../common/errors/app-error.js';
import type { Pool } from 'pg';
import { encryptSecret } from '../../../common/crypto/encryption.js';
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
      branch_name: string | null;
      account_type: 'SAVINGS' | 'CURRENT' | 'OTHER' | null;
      ownership_type: 'INDIVIDUAL' | 'BUSINESS';
      legal_entity_name: string | null;
      supporting_document_id: string | null;
      upi_id: string | null;
      is_verified: boolean;
      name_comparison: string;
      proof_status: string | null;
      proof_approval_id: string | null;
      review_status: string | null;
      rejection_reason: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, account_holder_name, account_number_last4, ifsc_code,
              bank_name, branch_name, account_type, ownership_type, legal_entity_name, supporting_document_id, upi_id, is_verified, created_at, updated_at,
              CASE WHEN EXISTS(SELECT 1 FROM users u LEFT JOIN partners p ON p.user_id=u.id WHERE u.id=provider_bank_accounts.user_id AND lower(regexp_replace(provider_bank_accounts.account_holder_name,'[^[:alnum:]]','','g')) IN (lower(regexp_replace(concat_ws(' ',u.first_name,u.last_name),'[^[:alnum:]]','','g')),lower(regexp_replace(COALESCE(p.business_name,''),'[^[:alnum:]]','','g')))) THEN 'NAME_MATCH' ELSE 'MANUAL_REVIEW_REQUIRED' END AS name_comparison,
              (SELECT status::text FROM partner_documents d WHERE d.id=provider_bank_accounts.supporting_document_id) AS proof_status,
              (SELECT r.id FROM provider_approval_requests r WHERE r.target_type='partner_document' AND r.target_id=provider_bank_accounts.supporting_document_id ORDER BY r.submitted_at DESC,r.id DESC LIMIT 1) AS proof_approval_id,
              (SELECT status FROM provider_approval_requests r WHERE r.target_type='bank_account' AND r.target_id=provider_bank_accounts.id ORDER BY submitted_at DESC,id DESC LIMIT 1) AS review_status,
              (SELECT rejection_reason FROM provider_approval_requests r WHERE r.target_type='bank_account' AND r.target_id=provider_bank_accounts.id ORDER BY submitted_at DESC,id DESC LIMIT 1) AS rejection_reason
       FROM provider_bank_accounts
       WHERE user_id = $1 AND EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.status='active' AND u.deleted_at IS NULL)`,
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
      branchName: row.branch_name,
      accountType: row.account_type,
      ownershipType: row.ownership_type,
      legalEntityName: row.legal_entity_name,
      supportingDocumentId: row.supporting_document_id,
      upiId: row.upi_id,
      isVerified: row.is_verified,
      nameComparison: row.name_comparison,
      supportingDocumentStatus: row.proof_status,
      supportingDocumentApprovalId: row.proof_approval_id,
      reviewStatus: row.review_status ?? null,
      rejectionReason: row.rejection_reason ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async upsertBankAccount(
    userId: string,
    input: UpsertBankAccountInput,
  ): Promise<ProviderBankAccount> {
    const last4 = input.accountNumber.slice(-4);
    const encrypted = encryptSecret(input.accountNumber);

    const result = await this.pool.query<{
      id: string;
      user_id: string;
      account_holder_name: string;
      account_number_last4: string;
      ifsc_code: string;
      bank_name: string;
      branch_name: string | null;
      account_type: 'SAVINGS' | 'CURRENT' | 'OTHER' | null;
      ownership_type: 'INDIVIDUAL' | 'BUSINESS';
      legal_entity_name: string | null;
      supporting_document_id: string | null;
      upi_id: string | null;
      is_verified: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO provider_bank_accounts (
         user_id, account_holder_name, account_number_encrypted, account_number_last4,
         ifsc_code, bank_name, upi_id, is_verified, updated_at,
         branch_name, account_type, ownership_type, legal_entity_name, supporting_document_id
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), $8, $9, $10, $11, $12
       WHERE EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.status='active' AND u.deleted_at IS NULL) AND ($12::uuid IS NULL OR EXISTS (
         SELECT 1 FROM partner_documents d JOIN partners p ON p.id=d.partner_id
         WHERE d.id=$12 AND p.user_id=$1 AND d.vehicle_id IS NULL
         AND lower(d.metadata->>'documentCode') IN ('bank_proof','cancelled_cheque','bank_passbook','bank_statement')
         AND d.metadata->'storage'->>'storageKey' IS NOT NULL
       ))
       ON CONFLICT (user_id) DO UPDATE SET
         account_holder_name = EXCLUDED.account_holder_name,
         account_number_encrypted = EXCLUDED.account_number_encrypted,
         account_number_last4 = EXCLUDED.account_number_last4,
         ifsc_code = EXCLUDED.ifsc_code,
         bank_name = EXCLUDED.bank_name,
         upi_id = EXCLUDED.upi_id,
         branch_name = EXCLUDED.branch_name,
         account_type = EXCLUDED.account_type,
         ownership_type = EXCLUDED.ownership_type,
         legal_entity_name = EXCLUDED.legal_entity_name,
         supporting_document_id = EXCLUDED.supporting_document_id,
         is_verified = FALSE,
         verified_by = NULL, verified_at = NULL,
         updated_at = NOW()
       RETURNING id, user_id, account_holder_name, account_number_last4, ifsc_code,
                 bank_name, branch_name, account_type, ownership_type, legal_entity_name, supporting_document_id, upi_id, is_verified, created_at, updated_at`,
      [
        userId,
        input.accountHolderName,
        encrypted,
        last4,
        input.ifscCode,
        input.bankName,
        input.upiId ?? null,
        input.branchName ?? null,
        input.accountType ?? null,
        input.ownershipType ?? 'INDIVIDUAL',
        input.legalEntityName ?? null,
        input.supportingDocumentId ?? null,
      ],
    );

    const row = result.rows[0];
    if (!row)
      throw new AppError(
        'BANK_PROOF_NOT_ACCESSIBLE',
        'Select an uploaded bank proof belonging to your account',
        403,
      );

    return {
      id: row.id,
      userId: row.user_id,
      accountHolderName: row.account_holder_name,
      accountNumberMasked: `••••••••${row.account_number_last4}`,
      accountNumberLast4: row.account_number_last4,
      ifscCode: row.ifsc_code,
      bankName: row.bank_name,
      branchName: row.branch_name,
      accountType: row.account_type,
      ownershipType: row.ownership_type,
      legalEntityName: row.legal_entity_name,
      supportingDocumentId: row.supporting_document_id,
      upiId: row.upi_id,
      isVerified: row.is_verified,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
