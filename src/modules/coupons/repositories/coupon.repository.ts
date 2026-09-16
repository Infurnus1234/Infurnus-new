import type { Pool, PoolClient } from 'pg';

import type { Coupon, CouponDiscountType, CouponRedemption } from '../types/coupon.js';

export interface CouponRepository {
  findByCode(code: string): Promise<Coupon | null>;

  findByCodeForUpdate(code: string, client: PoolClient): Promise<Coupon | null>;

  countUserRedemptions(couponId: string, userId: string, client: PoolClient): Promise<number>;

  incrementUsage(couponId: string, client: PoolClient): Promise<boolean>;

  createRedemption(
    input: CreateCouponRedemptionInput,
    client: PoolClient,
  ): Promise<CouponRedemption>;
}

export interface CreateCouponRedemptionInput {
  couponId: string;
  userId: string;
  rideId: string;
  couponCode: string;
  discountType: CouponDiscountType;
  discountValue: number;
  fareBeforeDiscount: number;
  discountAmount: number;
  fareAfterDiscount: number;
}

const couponProjection = `
  id,
  code,
  discount_type AS "discountType",
  discount_value AS "discountValue",
  max_discount_amount AS "maxDiscountAmount",
  min_fare_amount AS "minFareAmount",
  usage_limit AS "usageLimit",
  per_user_limit AS "perUserLimit",
  starts_at AS "startsAt",
  expires_at AS "expiresAt",
  is_active AS "isActive",
  usage_count AS "usageCount",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const redemptionProjection = `
  id,
  coupon_id AS "couponId",
  user_id AS "userId",
  ride_id AS "rideId",
  coupon_code AS "couponCode",
  discount_type AS "discountType",
  discount_value AS "discountValue",
  fare_before_discount AS "fareBeforeDiscount",
  discount_amount AS "discountAmount",
  fare_after_discount AS "fareAfterDiscount",
  redeemed_at AS "redeemedAt",
  created_at AS "createdAt"
`;

function mapCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: row.id as string,
    code: row.code as string,
    discountType: row.discountType as CouponDiscountType,
    discountValue: Number(row.discountValue),
    maxDiscountAmount: row.maxDiscountAmount === null ? null : Number(row.maxDiscountAmount),
    minFareAmount: Number(row.minFareAmount),
    usageLimit: row.usageLimit === null ? null : Number(row.usageLimit),
    perUserLimit: row.perUserLimit === null ? null : Number(row.perUserLimit),
    startsAt: row.startsAt as Date,
    expiresAt: row.expiresAt === null ? null : (row.expiresAt as Date),
    isActive: row.isActive as boolean,
    usageCount: Number(row.usageCount),
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function mapRedemption(row: Record<string, unknown>): CouponRedemption {
  return {
    id: row.id as string,
    couponId: row.couponId as string,
    userId: row.userId as string,
    rideId: row.rideId as string,
    couponCode: row.couponCode as string,
    discountType: row.discountType as CouponDiscountType,
    discountValue: Number(row.discountValue),
    fareBeforeDiscount: Number(row.fareBeforeDiscount),
    discountAmount: Number(row.discountAmount),
    fareAfterDiscount: Number(row.fareAfterDiscount),
    redeemedAt: row.redeemedAt as Date,
    createdAt: row.createdAt as Date,
  };
}

function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export class PostgresCouponRepository implements CouponRepository {
  constructor(private readonly pool: Pool) {}

  async findByCode(code: string): Promise<Coupon | null> {
    const normalizedCode = normalizeCouponCode(code);

    const result = await this.pool.query(
      `SELECT ${couponProjection}
       FROM coupons
       WHERE UPPER(code) = $1`,
      [normalizedCode],
    );

    return result.rows[0] ? mapCoupon(result.rows[0]) : null;
  }

  async findByCodeForUpdate(code: string, client: PoolClient): Promise<Coupon | null> {
    const normalizedCode = normalizeCouponCode(code);

    const result = await client.query(
      `SELECT ${couponProjection}
       FROM coupons
       WHERE UPPER(code) = $1
       FOR UPDATE`,
      [normalizedCode],
    );

    return result.rows[0] ? mapCoupon(result.rows[0]) : null;
  }

  async countUserRedemptions(
    couponId: string,
    userId: string,
    client: PoolClient,
  ): Promise<number> {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM coupon_redemptions
       WHERE coupon_id = $1
         AND user_id = $2`,
      [couponId, userId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async incrementUsage(couponId: string, client: PoolClient): Promise<boolean> {
    const result = await client.query(
      `UPDATE coupons
       SET usage_count = usage_count + 1
       WHERE id = $1
         AND (
           usage_limit IS NULL
           OR usage_count < usage_limit
         )
       RETURNING id`,
      [couponId],
    );

    return result.rowCount === 1;
  }

  async createRedemption(
    input: CreateCouponRedemptionInput,
    client: PoolClient,
  ): Promise<CouponRedemption> {
    const result = await client.query(
      `INSERT INTO coupon_redemptions (
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
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5::coupon_discount_type,
         $6,
         $7,
         $8,
         $9
       )
       RETURNING ${redemptionProjection}`,
      [
        input.couponId,
        input.userId,
        input.rideId,
        normalizeCouponCode(input.couponCode),
        input.discountType,
        input.discountValue,
        input.fareBeforeDiscount,
        input.discountAmount,
        input.fareAfterDiscount,
      ],
    );

    return mapRedemption(result.rows[0]);
  }
}
