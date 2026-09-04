import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresVehicleRepository } from '../repositories/vehicle.repository.js';

function fakePool(
  query: (text: string, values: unknown[]) => Promise<{ rows: never[]; rowCount: number }>,
) {
  return { query } as unknown as Pool;
}

describe('Postgres vehicle repository projections', () => {
  it('uses an explicit public vehicle projection', async () => {
    let queryText = '';
    const repository = new PostgresVehicleRepository(
      fakePool(async (text) => {
        queryText = text;
        return { rows: [], rowCount: 0 };
      }),
    );
    await repository.findById('850e8400-e29b-41d4-a716-446655440000');
    expect(queryText).toContain('FROM vehicles');
    expect(queryText).toContain('plate_number AS "plateNumber"');
    expect(queryText).not.toContain('SELECT *');
  });
});
