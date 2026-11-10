import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { fixture } from './fleet-workflow-fixture.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Managed contact migration preserves legacy identity authority',
  () => {
    beforeAll(() => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Owned database required');
    });
    it('backfills only same-transaction fleet-created accounts without a prior credential or session', async () => {
      const f = await fixture();
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const id of ids) {
          await c.query(
            "INSERT INTO users(id,first_name,last_name,email,phone,role,email_verified) VALUES($1,'TEST_SAMPLE','Legacy',$2,$3,'driver',FALSE)",
            [
              id,
              id + '@example.invalid',
              '+919' + id.replace(/\D/g, '').slice(0, 9).padEnd(9, '0'),
            ],
          );
          await c.query(
            'INSERT INTO fleet_managed_driver_accounts(driver_user_id,partner_id,created_by) VALUES($1,$2,$3)',
            [id, f.partner, f.owner],
          );
        }
        await c.query(
          "INSERT INTO user_credentials(user_id,password_hash) VALUES($1,'preserve-historical-fixture-hash')",
          [ids[1]],
        );
        await c.query(
          "UPDATE fleet_managed_driver_accounts SET created_at=created_at+INTERVAL '1 second' WHERE driver_user_id=$1",
          [ids[2]],
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
      const source = await readFile(
        new URL(
          '../../../../migrations/085_managed_driver_contact_verification.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const update = source.slice(
        source.indexOf('UPDATE fleet_managed_driver_accounts'),
        source.lastIndexOf('COMMIT;'),
      );
      await pool.query(update);
      await pool.query(update);
      const rows = (
        await pool.query(
          'SELECT driver_user_id,provisioned_email,provisioned_phone FROM fleet_managed_driver_accounts WHERE driver_user_id=ANY($1::uuid[])',
          [ids],
        )
      ).rows;
      expect(rows.find((r) => r.driver_user_id === ids[0]).provisioned_email).toBe(
        ids[0] + '@example.invalid',
      );
      for (const id of ids.slice(1))
        expect(rows.find((r) => r.driver_user_id === id).provisioned_email).toBeNull();
      expect(
        (await pool.query('SELECT password_hash FROM user_credentials WHERE user_id=$1', [ids[1]]))
          .rows[0].password_hash,
      ).toBe('preserve-historical-fixture-hash');
      expect(
        (
          await pool.query(
            'SELECT bool_or(email_verified) AS verified FROM users WHERE id=ANY($1::uuid[])',
            [ids],
          )
        ).rows[0].verified,
      ).toBe(false);
    });
  },
);
