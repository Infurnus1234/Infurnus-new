import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresCouponRepository } from '../repositories/coupon.repository.js';

const databaseEnabled = process.env.COUPON_DB_TESTS === 'true';

const describeDatabase = databaseEnabled ? describe : describe.skip;

const repository = new PostgresCouponRepository(pool);

interface Fixture {
  userId: string;
  rideId: string;
  couponId: string;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const compact = suffix.replaceAll('-', '');

  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users
       (first_name, last_name, phone, role)
     VALUES
       ('Coupon', 'Customer', $1, 'customer')
     RETURNING id`,
    [`+91${compact.slice(0, 10)}`],
  );

  const rideResult = await pool.query<{ id: string }>(
    `INSERT INTO rides
       (
         customer_id,
         pickup_location,
         destination_location
       )
     VALUES
       (
         $1,
         ST_SetSRID(
           ST_MakePoint(75.7873, 26.9124),
           4326
         )::geography,
         ST_SetSRID(
           ST_MakePoint(75.8020, 26.8467),
           4326
         )::geography
       )
     RETURNING id`,
    [userResult.rows[0]!.id],
  );

  const couponResult = await pool.query<{ id: string }>(
    `INSERT INTO coupons
       (
         code,
         discount_type,
         discount_value,
         max_discount_amount,
         min_fare_amount,
         usage_limit,
         per_user_limit,
         starts_at,
         expires_at,
         is_active
       )
     VALUES
       (
         $1,
         'PERCENTAGE',
         20.00,
         5000,
         0,
         10,
         2,
         NOW() - INTERVAL '1 hour',
         NOW() + INTERVAL '1 day',
         TRUE
       )
     RETURNING id`,
    [`TEST-${compact.slice(0, 12).toUpperCase()}`],
  );

  return {
    userId: userResult.rows[0]!.id,
    rideId: rideResult.rows[0]!.id,
    couponId: couponResult.rows[0]!.id,
  };
}

async function cleanFixture(fixture: Fixture): Promise<void> {
  await pool.query(
    `DELETE FROM coupon_redemptions
     WHERE coupon_id = $1
        OR user_id = $2
        OR ride_id = $3`,
    [fixture.couponId, fixture.userId, fixture.rideId],
  );

  await pool.query(
    `DELETE FROM coupons
     WHERE id = $1`,
    [fixture.couponId],
  );

  await pool.query(
    `DELETE FROM rides
     WHERE id = $1`,
    [fixture.rideId],
  );

  await pool.query(
    `DELETE FROM users
     WHERE id = $1`,
    [fixture.userId],
  );
}

describeDatabase('coupon PostgreSQL integration', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterAll(async () => {
    if (fixture) {
      await cleanFixture(fixture);
    }

    await pool.end();
  });

  it('finds a coupon by normalized code', async () => {
    const couponResult = await pool.query<{
      code: string;
    }>(
      `SELECT code
         FROM coupons
         WHERE id = $1`,
      [fixture.couponId],
    );

    const code = couponResult.rows[0]!.code;

    const coupon = await repository.findByCode(`  ${code.toLowerCase()}  `);

    expect(coupon).not.toBeNull();
    expect(coupon!.id).toBe(fixture.couponId);
    expect(coupon!.code).toBe(code);
    expect(coupon!.discountType).toBe('PERCENTAGE');
    expect(coupon!.discountValue).toBe(20);
    expect(coupon!.maxDiscountAmount).toBe(5000);
    expect(coupon!.usageLimit).toBe(10);
    expect(coupon!.perUserLimit).toBe(2);
  });

  it('returns null for an unknown coupon', async () => {
    const coupon = await repository.findByCode(`MISSING-${randomUUID()}`);

    expect(coupon).toBeNull();
  });

  it('locks and returns a coupon inside a transaction', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const coupon = await repository.findByCodeForUpdate('INVALID-CODE', client);

      expect(coupon).toBeNull();

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('counts user redemptions correctly', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const initialCount = await repository.countUserRedemptions(
        fixture.couponId,
        fixture.userId,
        client,
      );

      expect(initialCount).toBe(0);

      await client.query(
        `INSERT INTO coupon_redemptions
             (
               coupon_id,
               user_id,
               ride_id,
               coupon_code,
               discount_type,
               discount_value,
               fare_before_discount,
               discount_amount,
               fare_after_discount
             )
           VALUES
             (
               $1,
               $2,
               $3,
               'TEST-REDEMPTION',
               'PERCENTAGE',
               20.00,
               10000,
               2000,
               8000
             )`,
        [fixture.couponId, fixture.userId, fixture.rideId],
      );

      const count = await repository.countUserRedemptions(fixture.couponId, fixture.userId, client);

      expect(count).toBe(1);

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('increments coupon usage', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const incremented = await repository.incrementUsage(fixture.couponId, client);

      expect(incremented).toBe(true);

      const result = await client.query<{
        usage_count: number;
      }>(
        `SELECT usage_count
           FROM coupons
           WHERE id = $1`,
        [fixture.couponId],
      );

      expect(Number(result.rows[0]!.usage_count)).toBe(1);

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('refuses to increment usage after the global limit', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE coupons
           SET usage_count = usage_limit
           WHERE id = $1`,
        [fixture.couponId],
      );

      const incremented = await repository.incrementUsage(fixture.couponId, client);

      expect(incremented).toBe(false);

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('creates an immutable redemption snapshot', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const created = await repository.createRedemption(
        {
          couponId: fixture.couponId,
          userId: fixture.userId,
          rideId: fixture.rideId,
          couponCode: ' test-snapshot ',
          discountType: 'PERCENTAGE',
          discountValue: 20,
          fareBeforeDiscount: 10000,
          discountAmount: 2000,
          fareAfterDiscount: 8000,
        },
        client,
      );

      expect(created.couponId).toBe(fixture.couponId);
      expect(created.userId).toBe(fixture.userId);
      expect(created.rideId).toBe(fixture.rideId);
      expect(created.couponCode).toBe('TEST-SNAPSHOT');
      expect(created.discountType).toBe('PERCENTAGE');
      expect(created.discountValue).toBe(20);
      expect(created.fareBeforeDiscount).toBe(10000);
      expect(created.discountAmount).toBe(2000);
      expect(created.fareAfterDiscount).toBe(8000);

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('enforces redemption fare arithmetic at the database level', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await expect(
        client.query(
          `INSERT INTO coupon_redemptions
               (
                 coupon_id,
                 user_id,
                 ride_id,
                 coupon_code,
                 discount_type,
                 discount_value,
                 fare_before_discount,
                 discount_amount,
                 fare_after_discount
               )
             VALUES
               (
                 $1,
                 $2,
                 $3,
                 'INVALID-MATH',
                 'PERCENTAGE',
                 20.00,
                 10000,
                 2000,
                 9000
               )`,
          [fixture.couponId, fixture.userId, fixture.rideId],
        ),
      ).rejects.toBeDefined();

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
});
