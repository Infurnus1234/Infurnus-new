import type { PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';

export class ProviderPublicIdService {
  async ensure(
    client: Pick<PoolClient, 'query'>,
    accountId: string,
    source: 'registration' | 'backfill' = 'registration',
    batchId: string | null = null,
  ): Promise<string> {
    try {
      const result = await client.query<{ publicId: string }>(
        'SELECT ensure_provider_identity($1,$2,$3) AS "publicId"',
        [accountId, source, batchId],
      );
      return result.rows[0]!.publicId;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P1001')
        throw new AppError(
          'PROVIDER_IDENTITY_RECONCILIATION_REQUIRED',
          'Sign in to your existing provider account or verify both accounts before linking them.',
          409,
        );
      if (code === 'P1002')
        throw new AppError(
          'PROVIDER_ID_CAPACITY_EXHAUSTED',
          'Provider ID capacity is exhausted. A Super Admin must activate a larger ID length.',
          503,
        );
      throw error;
    }
  }
}
