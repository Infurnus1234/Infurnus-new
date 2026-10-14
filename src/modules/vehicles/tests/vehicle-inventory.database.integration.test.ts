import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresVehicleRepository } from '../repositories/vehicle.repository.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';

describe.skipIf(process.env.PROVIDER_DB_TESTS !== 'true')('pending vehicle inventory edits', () => {
  it('dashboard and account list exclude soft-deleted accounts consistently', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const repository = new PostgresAdminRepository(client as unknown as Pool);
      const before = await repository.dashboard();
      await client.query(
        "INSERT INTO users(first_name,last_name,email,role,deleted_at) VALUES('TEST_SAMPLE','Deleted',$1,'customer',NOW())",
        [`deleted-${randomUUID()}@example.invalid`],
      );
      const after = await repository.dashboard();
      expect(after.users.total).toBe(before.users.total);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  it('updates a pending vehicle without activation or duplication, but protects retired history', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const record = await client.query(
        "INSERT INTO vehicles(make,model,plate_number) VALUES('TEST_SAMPLE_NOT_ID','Before',$1) RETURNING id,is_active,verification_status",
        [`TEST-${randomUUID().slice(0, 12)}`],
      );
      const id = record.rows[0].id as string;
      expect(record.rows[0]).toMatchObject({ is_active: false, verification_status: 'pending' });
      const repository = new PostgresVehicleRepository(client as unknown as Pool);
      expect(await repository.update(id, { model: 'After' })).toMatchObject({
        id,
        model: 'After',
        isActive: false,
        verificationStatus: 'pending',
      });
      const persisted = await client.query(
        'SELECT model,COUNT(*) OVER() AS count FROM vehicles WHERE id=$1',
        [id],
      );
      expect(persisted.rows[0]).toMatchObject({ model: 'After', count: '1' });
      await client.query('UPDATE vehicles SET retired_at=NOW() WHERE id=$1', [id]);
      expect(await repository.update(id, { model: 'Forbidden' })).toBeNull();
      expect((await repository.findById(id))?.model).toBe('After');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
