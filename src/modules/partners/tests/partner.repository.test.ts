import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresPartnerRepository } from '../repositories/partner.repository.js';

function fakePool(query: (text: string, values: unknown[]) => Promise<{ rows: never[] }>) {
  return { query } as unknown as Pool;
}

describe('Postgres partner repository projections', () => {
  it('does not expose internal rejection details', async () => {
    let queryText = '';
    const repository = new PostgresPartnerRepository(
      fakePool(async (text) => {
        queryText = text;
        return { rows: [] };
      }),
    );

    await repository.findById('650e8400-e29b-41d4-a716-446655440000');

    expect(queryText).toContain('FROM partners');
    expect(queryText).toContain('business_name AS "businessName"');
    expect(queryText).not.toContain('rejection_reason');
  });
});
