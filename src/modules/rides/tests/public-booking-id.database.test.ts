import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../../../infrastructure/database/postgres.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { AdminOperationsRepository } from '../../admin/repositories/operations.repository.js';
import { createAdminOperationsRouter } from '../../admin/routes/operations.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { privateBookingPayload } from '../utils/booking-contact.js';

describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'public Booking IDs and manual coordination',
  () => {
    beforeAll(() => requireDisposableAdministrativeDatabase());
    async function user() {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO users(id,first_name,last_name,role,phone) VALUES($1,'Booking','Customer','customer',$2)",
        [id, '+91' + String(Date.now()).slice(-10)],
      );
      return id;
    }
    async function ride(
      customer: string,
      sector: string,
      client: Pick<PoolClient, 'query'> = pool,
    ) {
      return (
        await client.query(
          `INSERT INTO rides(customer_id,pickup_location,destination_location,sector,status,pickup_address,destination_address,fare_estimate)
      VALUES($1,ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography,ST_SetSRID(ST_MakePoint(85.4,26.1),4326)::geography,$2,'searching','Pickup','Drop',100) RETURNING *`,
          [customer, sector],
        )
      ).rows[0];
    }
    it.each([
      ['rental', '11'],
      ['service', '22'],
      ['premium', '33'],
      ['logistics', '44'],
    ])('allocates %s public reference and preserves UUID', async (sector, prefix) => {
      const r = await ride(await user(), sector);
      expect(r.id).toMatch(/^[a-f0-9-]{36}$/);
      expect(r.booking_id).toMatch(new RegExp('^' + prefix + '[0-9]{5}$'));
      expect(r.booking_id_expires_at).toBeNull();
      await pool.query("UPDATE rides SET status='driver_assigned' WHERE id=$1", [r.id]);
      const next = (await pool.query('SELECT * FROM rides WHERE id=$1', [r.id])).rows[0];
      expect(next.booking_id).toBe(r.booking_id);
      expect(next.booking_id_expires_at).toBeNull();
    });
    it('concurrent allocations have database-enforced active uniqueness', async () => {
      const customer = await user();
      const records = await Promise.all(
        Array.from({ length: 40 }, () => ride(customer, 'premium')),
      );
      expect(new Set(records.map((r) => r.booking_id)).size).toBe(40);
    });
    it.each(['completed', 'cancelled'])(
      'starts exactly seven days after %s and is idempotent',
      async (status) => {
        const r = await ride(await user(), 'rental');
        if (status === 'completed')
          for (const step of [
            'driver_assigned',
            'driver_arriving',
            'driver_arrived',
            'in_progress',
          ])
            await pool.query(
              "UPDATE rides SET status=$2::ride_status,pin_verified=($2::text='in_progress') WHERE id=$1",
              [r.id, step],
            );
        const final = (
          await pool.query(
            `UPDATE rides SET status=$2,${status === 'completed' ? 'completed_at' : 'cancelled_at'}=clock_timestamp()${status === 'cancelled' ? ",cancellation_reason='LOCAL TEST'" : ''} WHERE id=$1 RETURNING *`,
            [r.id, status],
          )
        ).rows[0];
        const time = final.completed_at ?? final.cancelled_at;
        expect(+final.booking_id_expires_at - +time).toBe(7 * 86400000);
        await pool.query('UPDATE rides SET updated_at=NOW() WHERE id=$1', [r.id]);
        expect(
          +(await pool.query('SELECT booking_id_expires_at FROM rides WHERE id=$1', [r.id])).rows[0]
            .booking_id_expires_at,
        ).toBe(+final.booking_id_expires_at);
      },
    );
    it('supports leading zeros, controlled collisions, expiry/reuse and unambiguous current lookup', async () => {
      const customer = await user(),
        client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Deterministic test-only CSPRNG stub, rolled back with this transaction.
        await client.query(
          "CREATE OR REPLACE FUNCTION booking_id_random_suffix() RETURNS text LANGUAGE sql AS $$ SELECT '00382'::text $$",
        );
        const old = await ride(customer, 'logistics', client);
        expect(old.booking_id).toBe('4400382');
        await client.query('SAVEPOINT collision');
        await expect(ride(customer, 'logistics', client)).rejects.toMatchObject({ code: 'P2001' });
        await client.query('ROLLBACK TO SAVEPOINT collision');
        await client.query("UPDATE rides SET created_at=NOW()-interval '9 days' WHERE id=$1", [
          old.id,
        ]);
        await client.query(
          "UPDATE rides SET status='cancelled',cancellation_reason='LOCAL TEST',cancelled_at=NOW()-interval '8 days' WHERE id=$1",
          [old.id],
        );
        await client.query('SELECT release_expired_booking_ids()');
        await client.query('SELECT release_expired_booking_ids()');
        const fresh = await ride(customer, 'logistics', client);
        expect(fresh.booking_id).toBe(old.booking_id);
        expect(fresh.id).not.toBe(old.id);
        expect(
          (
            await client.query(
              'SELECT ride_id FROM booking_id_allocations WHERE booking_id=$1 AND released_at IS NULL',
              [old.booking_id],
            )
          ).rows,
        ).toEqual([{ ride_id: fresh.id }]);
        expect((await client.query('SELECT id FROM rides WHERE id=$1', [old.id])).rowCount).toBe(1);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it('Admin lookup requires role plus sensitive grants, and participant payloads omit personal numbers', async () => {
      const customer = await user(),
        r = await ride(customer, 'service');
      const repo = new AdminOperationsRepository(pool);
      const detail = await repo.bookingReference(r.booking_id);
      expect(detail?.rideId).toBe(r.id);
      expect(detail?.customer.id).toBe(customer);
      expect(detail?.customer.phone).toBeTruthy();
      expect(JSON.stringify(privateBookingPayload({ ride: detail }))).not.toContain(
        detail.customer.phone,
      );
      const app = express();
      const fake = Object.create(repo) as AdminOperationsRepository;
      fake.authorize = async () => undefined;
      app.use('/admin/operations', createAdminOperationsRouter(fake));
      app.use(errorMiddleware);
      const path = '/admin/operations/booking-reference/' + r.booking_id;
      expect((await request(app).get(path)).status).toBe(401);
      for (const role of ['customer', 'driver', 'admin'] as const) {
        const token = await signAccessToken({ sub: customer, role, type: 'access' });
        expect((await request(app).get(path).auth(token, { type: 'bearer' })).status).toBe(403);
      }
      const token = await signAccessToken({ sub: customer, role: 'super_admin', type: 'access' });
      const response = await request(app).get(path).auth(token, { type: 'bearer' });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.data.bookingId).toBe(r.booking_id);
    });
  },
);
