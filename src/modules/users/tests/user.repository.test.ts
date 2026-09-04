import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresUserRepository } from '../repositories/user.repository.js';

function fakePool(query: (text: string, values: unknown[]) => Promise<{ rows: never[] }>) {
  return { query } as unknown as Pool;
}

describe('Postgres user repository projections', () => {
  it('uses a minimal public projection for user history', async () => {
    let queryText = '';
    const repository = new PostgresUserRepository(
      fakePool(async (text) => {
        queryText = text;
        return { rows: [] };
      }),
    );

    await repository.findHistory('550e8400-e29b-41d4-a716-446655440000', 50);

    expect(queryText).toContain('FROM user_history');
    expect(queryText).toContain('event_type AS "eventType"');
    expect(queryText).not.toContain('metadata');
    expect(queryText).not.toContain('password');
    expect(queryText).toContain('LIMIT $2');
  });
});
