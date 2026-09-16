import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { CouponCalculatorService } from '../services/coupon-calculator.service.js';
import { CouponRedemptionService } from '../services/coupon-redemption.service.js';
import { PostgresCouponRepository } from '../repositories/coupon.repository.js';

const databaseEnabled = process.env.COUPON_DB_TESTS === 'true';
const describeDatabase = databaseEnabled ? describe : describe.skip;

const couponRepository = new PostgresCouponRepository(pool);
const calculator = new CouponCalculatorService();
const service = new CouponRedemptionService(
  couponRepository,
  calculator,
);

interface Fixture {
  couponId: string;
  userId: string;
  rideId: string;
  code: string;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().replaceAll('-', '');
  const phone = `+91${suffix.slice(0, 10)}`;
  const code = `CONCURRENT-${suffix.slice(0, 12).toUpperCase()}`;

  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (first_name, last_name, phone, role)
     VALUES ('Coupon', 'Concurrency', $1, 'customer')
     RETURNING id`,
    [phone],
  );

  const ride = await pool.query<{ id: string }>(
    `INSERT INTO rides
       (customer_id, pickup_location, destination_location)
     VALUES (
       $1,
       ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography,
       ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography
     )
     RETURNING id`,
    [user.rows[0]!.id],
  );

  const coupon = await pool.query<{ id: string }>(
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
         is_active,
         usage_count
       )
     VALUES
       (
         $1,
         'PERCENTAGE',
         10,
         5000,
         0,
         1,
         NULL,
         NOW() - INTERVAL '1 hour',
         NOW() + INTERVAL '1 hour',
         TRUE,
         0
       )
     RETURNING id`,
    [code],
  );

  return {
    couponId: coupon.rows[0]!.id,
    userId: user.rows[0]!.id,
    rideId: ride.rows[0]!.id,
    code,
  };
}

async function cleanFixture(fixture: Fixture): Promise<void> {
  await pool.query(
    `DELETE FROM coupon_redemptions
     WHERE coupon_id = $1`,
    [fixture.couponId],
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

describeDatabase('coupon PostgreSQL concurrency integration', () => {
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

  it('allows exactly one successful redemption when usage_limit is 1', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.redeem({
          couponCode: fixture.code,
          userId: fixture.userId,
          rideId: fixture.rideId,
          fareAmount: 10000,
        }),
      ),
    );

    const successful = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const failed = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(9);

    const coupon = await pool.query<{ usage_count: number }>(
      `SELECT usage_count
       FROM coupons
       WHERE id = $1`,
      [fixture.couponId],
    );

    expect(coupon.rows).toHaveLength(1);
    expect(Number(coupon.rows[0]!.usage_count)).toBe(1);

    const redemptions = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM coupon_redemptions
       WHERE coupon_id = $1`,
      [fixture.couponId],
    );

    expect(redemptions.rows).toHaveLength(1);
    expect(redemptions.rows[0]!.count).toBe('1');

    const redemption = await pool.query<{
      user_id: string;
      ride_id: string;
      coupon_code: string;
      fare_before_discount: string;
      discount_amount: string;
      fare_after_discount: string;
    }>(
      `SELECT
         user_id,
         ride_id,
         coupon_code,
         fare_before_discount,
         discount_amount,
         fare_after_discount
       FROM coupon_redemptions
       WHERE coupon_id = $1`,
      [fixture.couponId],
    );

    expect(redemption.rows).toHaveLength(1);

    const snapshot = redemption.rows[0]!;

    expect(snapshot.user_id).toBe(fixture.userId);
    expect(snapshot.ride_id).toBe(fixture.rideId);
    expect(snapshot.coupon_code).toBe(fixture.code);
    expect(Number(snapshot.fare_before_discount)).toBe(10000);
    expect(Number(snapshot.discount_amount)).toBe(1000);
    expect(Number(snapshot.fare_after_discount)).toBe(9000);
  });
});
