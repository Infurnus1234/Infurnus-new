import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { env, envSchema } from '../../../config/env.js';
import { driverEligibilitySql, dispatchTestScopeSql } from '../repositories/driver-eligibility.js';

// This is real PostGIS SQL; no production identity or eligibility is mocked.
describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'private live-device dispatch pair isolation',
  () => {
    const customers = [randomUUID(), randomUUID()];
    const drivers = [randomUUID(), randomUUID()];
    const profiles: string[] = [];
    const vehicles: string[] = [];
    const previous = [env.DISPATCH_TEST_CUSTOMER_ID, env.DISPATCH_TEST_DRIVER_USER_ID];
    beforeAll(async () => {
      for (const id of customers)
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'Scope','Fixture',$2,'customer')",
          [id, `${id}@example.invalid`],
        );
      for (const id of drivers) {
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'Scope','Fixture',$2,'driver_fleet_owner')",
          [id, `${id}@example.invalid`],
        );
        const profile = (
          await pool.query(
            "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,availability_status,last_location,last_location_at) VALUES($1,$2,'2030-12-31','approved','available',ST_SetSRID(ST_MakePoint(85.13,25.60),4326)::geography,NOW()) RETURNING id",
            [id, 'SCOPE-' + id],
          )
        ).rows[0].id;
        profiles.push(profile);
        const vehicle = (
          await pool.query(
            "INSERT INTO vehicles(driver_profile_id,owner_id,make,model,plate_number,sector,category,verification_status,is_active) VALUES($1,$2,'Scope','Fixture',$3,'passenger','scope_fixture','approved',TRUE) RETURNING id",
            [profile, id, 'SCOPE' + id.replaceAll('-', '').slice(0, 12)],
          )
        ).rows[0].id;
        vehicles.push(vehicle);
        await pool.query('UPDATE driver_profiles SET active_vehicle_id=$2 WHERE id=$1', [
          profile,
          vehicle,
        ]);
      }
      env.DISPATCH_TEST_CUSTOMER_ID = customers[0];
      env.DISPATCH_TEST_DRIVER_USER_ID = drivers[0];
    });
    afterAll(async () => {
      [env.DISPATCH_TEST_CUSTOMER_ID, env.DISPATCH_TEST_DRIVER_USER_ID] = previous;
      await pool.query(
        'UPDATE driver_profiles SET active_vehicle_id=NULL WHERE id=ANY($1::uuid[])',
        [profiles],
      );
      await pool.query('DELETE FROM vehicles WHERE id=ANY($1::uuid[])', [vehicles]);
      await pool.query('DELETE FROM driver_profiles WHERE id=ANY($1::uuid[])', [profiles]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[...customers, ...drivers]]);
    });
    async function eligible(customer?: string) {
      const sql = driverEligibilitySql(
        "NOW()-INTERVAL '5 minutes'",
        undefined,
        customer ? '$1::uuid' : undefined,
      );
      return (
        await pool.query(
          `SELECT dp.user_id FROM driver_profiles dp JOIN users u ON u.id=dp.user_id JOIN vehicles v ON v.id=dp.active_vehicle_id WHERE dp.id=ANY($${customer ? 2 : 1}::uuid[]) AND ${customer ? '$1::uuid IS NOT NULL' : 'TRUE'} AND ${sql} ORDER BY dp.user_id`,
          customer ? [customer, profiles] : [profiles],
        )
      ).rows.map((r) => r.user_id);
    }
    it('test customer can match only the test driver', async () => {
      expect(await eligible(customers[0])).toEqual([drivers[0]]);
    });
    it('ordinary customer cannot match the simulated test driver', async () => {
      expect(await eligible(customers[1])).toEqual([drivers[1]]);
    });
    it('public availability excludes the simulated test driver', async () => {
      expect(await eligible()).toEqual([drivers[1]]);
    });
    it('paired driver still needs real operational availability', async () => {
      await pool.query("UPDATE driver_profiles SET availability_status='unavailable' WHERE id=$1", [
        profiles[0],
      ]);
      expect(await eligible(customers[0])).toEqual([]);
      await pool.query("UPDATE driver_profiles SET availability_status='available' WHERE id=$1", [
        profiles[0],
      ]);
    });
    it('absent configuration preserves ordinary matching; incomplete config fails closed', async () => {
      env.DISPATCH_TEST_CUSTOMER_ID = undefined;
      env.DISPATCH_TEST_DRIVER_USER_ID = undefined;
      expect(new Set(await eligible(customers[1]))).toEqual(new Set(drivers));
      env.DISPATCH_TEST_CUSTOMER_ID = customers[0];
      expect(dispatchTestScopeSql('$1')).toBe('FALSE');
      env.DISPATCH_TEST_DRIVER_USER_ID = drivers[0];
    });
    it('configuration rejects partial or identical account pairs', () => {
      const base = {
        ...process.env,
        DISPATCH_TEST_CUSTOMER_ID: customers[0],
        DISPATCH_TEST_DRIVER_USER_ID: drivers[0],
      };
      expect(envSchema.safeParse(base).success).toBe(true);
      expect(
        envSchema.safeParse({ ...base, DISPATCH_TEST_DRIVER_USER_ID: undefined }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({ ...base, DISPATCH_TEST_DRIVER_USER_ID: customers[0] }).success,
      ).toBe(false);
    });
  },
);
