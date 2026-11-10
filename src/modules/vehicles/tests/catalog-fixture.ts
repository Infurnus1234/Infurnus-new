import type { Pool } from 'pg';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';

/** Keep operator-price tests from changing the next test file's seed baseline. */
export async function preserveCatalogFixture(pool: Pool): Promise<() => Promise<void>> {
  requireDisposableAdministrativeDatabase();
  const rows = (await pool.query('SELECT * FROM vehicle_types ORDER BY id')).rows;
  return async () => {
    requireDisposableAdministrativeDatabase();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const updates = Object.keys(row).map(key => `"${key.replaceAll('"', '""')}"=EXCLUDED."${key.replaceAll('"', '""')}"`).join(',');
        await client.query(`INSERT INTO vehicle_types SELECT * FROM jsonb_populate_record(NULL::vehicle_types,$1::jsonb) ON CONFLICT(sector,code) DO UPDATE SET ${updates}`, [JSON.stringify(row)]);
      }
      await client.query('DELETE FROM vehicle_types WHERE NOT(id=ANY($1::uuid[]))', [rows.map(row => row.id)]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
}
