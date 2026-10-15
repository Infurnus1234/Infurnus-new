import { randomUUID } from 'node:crypto';
import { readFile, readdir, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
describe.skipIf(process.env.RIDE_DB_TESTS !== 'true')(
  'dispatch migration 066 compatibility',
  () => {
    it.each([false, true])(
      'HD-MIGRATION-duplicates-%s: preserve history and fail safely',
      async (duplicate) => {
        const url = new URL(process.env.DATABASE_URL!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5434')
          throw Error('Local migration database required');
        url.pathname = '/postgres';
        const admin = new Pool({ connectionString: url.toString() }),
          name = 'dispatch_migration_' + randomUUID().replaceAll('-', '');
        await admin.query(`CREATE DATABASE "${name}"`);
        url.pathname = '/' + name;
        const db = new Pool({ connectionString: url.toString(), max: 1 });
        if (!/^dispatch_migration_[a-f0-9]{32}$/.test(name))
          throw Error('Unsafe migration database name');
        try {
          const files = (await readdir(resolve('migrations')))
            .filter((f) => f.endsWith('.sql') && f < '066_')
            .sort();
          for (const file of files)
            await db.query(await readFile(resolve('migrations', file), 'utf8'));
          if (duplicate) {
            const customer = randomUUID(),
              driver = randomUUID(),
              profile = randomUUID(),
              ride = randomUUID();
            await db.query(
              "INSERT INTO users(id,first_name,last_name,role) VALUES($1,'TEST','Migration','customer'),($2,'TEST','Migration','driver')",
              [customer, driver],
            );
            await db.query(
              "INSERT INTO driver_profiles(id,user_id,license_number,license_expiry) VALUES($1,$2,'TEST MIGRATION',CURRENT_DATE+365)",
              [profile, driver],
            );
            await db.query(
              "INSERT INTO rides(id,customer_id,pickup_location,destination_location,pin) VALUES($1,$2,ST_SetSRID(ST_MakePoint(77,13),4326)::geography,ST_SetSRID(ST_MakePoint(77.1,13),4326)::geography,'1234')",
              [ride, customer],
            );
            await db.query(
              "INSERT INTO ride_dispatch_attempts(ride_id,driver_profile_id,attempt,status,offered_at,expires_at,responded_at) VALUES($1,$2,1,'timed_out',NOW()-INTERVAL '1 minute',NOW()-INTERVAL '30 seconds',NOW()),($1,$2,2,'timed_out',NOW()-INTERVAL '1 minute',NOW()-INTERVAL '30 seconds',NOW())",
              [ride, profile],
            );
          }
          const migration = await readFile(
            resolve('migrations/066_harden_dispatch_request_identity.sql'),
            'utf8',
          );
          if (duplicate) {
            await expect(db.query(migration)).rejects.toMatchObject({ code: '23505' });
            await db.query('ROLLBACK');
            expect(
              (await db.query('SELECT count(*)::int AS n FROM ride_dispatch_attempts')).rows[0].n,
            ).toBe(2);
            expect(
              (
                await db.query(
                  "SELECT to_regclass('ride_dispatch_attempts_ride_driver_uidx') AS idx",
                )
              ).rows[0].idx,
            ).toBeNull();
          } else {
            await db.query(migration);
            expect(
              (
                await db.query(
                  "SELECT to_regclass('ride_dispatch_attempts_ride_driver_uidx') AS idx",
                )
              ).rows[0].idx,
            ).toBe('ride_dispatch_attempts_ride_driver_uidx');
          }
          if (process.env.DISPATCH_QA_EVIDENCE_DIR)
            await appendFile(
              join(process.env.DISPATCH_QA_EVIDENCE_DIR, 'qa-migrations.jsonl'),
              JSON.stringify({
                id: `HD-MIGRATION-${duplicate}`,
                duplicate,
                expected: duplicate
                  ? '23505; both historical attempts retained'
                  : 'migration succeeds',
                time: new Date().toISOString(),
                customers: duplicate ? 1 : 0,
                drivers: duplicate ? 1 : 0,
                vehicles: 0,
              }) + '\n',
            );
        } finally {
          await db.end();
          // Pool.end resolves when clients are released; wait for PostgreSQL to
          // observe their Terminate packets before dropping this owned database.
          // FORCE could otherwise race socket shutdown and emit an unhandled 57P01.
          for (let retry = 0; retry < 100; retry++) {
            const live = await admin.query(
              'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',
              [name],
            );
            if (live.rows[0].n === 0) break;
            await delay(10);
          }
          await admin.query(`DROP DATABASE "${name}"`);
          await admin.end();
        }
      },
      30000,
    );
  },
);
