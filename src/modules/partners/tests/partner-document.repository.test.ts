import { describe, expect, it, vi } from 'vitest';

import { PostgresPartnerDocumentRepository } from '../repositories/partner-document.repository.js';

function poolWithRows(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({
    rows,
    rowCount: rows.length,
  });

  return {
    query,
    pool: { query } as never,
  };
}

describe('PostgresPartnerDocumentRepository', () => {
  it('uses an explicit projection with storage metadata but without document numbers or SELECT *', async () => {
    const { pool, query } = poolWithRows();

    await new PostgresPartnerDocumentRepository(pool).findByPartner(
      '650e8400-e29b-41d4-a716-446655440000',
    );

    const sql = query.mock.calls[0]![0] as string;

    expect(sql).toContain('metadata');
    expect(sql).not.toMatch(/document_?number/i);
    expect(sql).not.toContain('SELECT *');
  });
});
