import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { CouponRedemptionService } from '../services/coupon-redemption.service.js';
import type { CouponRedemption } from '../types/coupon.js';

const userId = '550e8400-e29b-41d4-a716-446655440000';
const otherUserId = '660e8400-e29b-41d4-a716-446655440000';
const rideId = '750e8400-e29b-41d4-a716-446655440000';

const redemption: CouponRedemption = {
  id: '850e8400-e29b-41d4-a716-446655440000',
  couponId: '960e8400-e29b-41d4-a716-446655440000',
  userId,
  rideId,
  couponCode: 'SAVE10',
  discountType: 'PERCENTAGE',
  discountValue: 10,
  fareBeforeDiscount: 10000,
  discountAmount: 1000,
  fareAfterDiscount: 9000,
  redeemedAt: new Date('2026-09-15T10:00:00.000Z'),
  createdAt: new Date('2026-09-15T10:00:00.000Z'),
};

async function tokenFor(id: string) {
  return signAccessToken({
    sub: id,
    role: 'customer',
    type: 'access',
  });
}

function createTestApp() {
  const redeem = vi.fn().mockResolvedValue(redemption);

  const service = {
    redeem,
  } as unknown as CouponRedemptionService;

  const app = createApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    service,
  );

  return {
    app,
    redeem,
  };
}

describe('Coupon HTTP integration', () => {
  describe('POST /coupons/redeem', () => {
    it('rejects unauthenticated requests', async () => {
      const { app, redeem } = createTestApp();

      const response = await request(app).post('/coupons/redeem').send({
        couponCode: 'SAVE10',
        rideId,
        fareAmount: 10000,
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(redeem).not.toHaveBeenCalled();
    });

    it('redeems a coupon for the authenticated user', async () => {
      const { app, redeem } = createTestApp();
      const token = await tokenFor(userId);

      const response = await request(app)
        .post('/coupons/redeem')
        .set('authorization', `Bearer ${token}`)
        .send({
          couponCode: 'SAVE10',
          rideId,
          fareAmount: 10000,
        });

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: redemption.id,
          userId,
          rideId,
          couponCode: 'SAVE10',
          fareBeforeDiscount: 10000,
          discountAmount: 1000,
          fareAfterDiscount: 9000,
        },
        message: 'Coupon redeemed',
      });

      expect(redeem).toHaveBeenCalledTimes(1);

      expect(redeem).toHaveBeenCalledWith({
        couponCode: 'SAVE10',
        userId,
        rideId,
        fareAmount: 10000,
      });
    });

    it('uses the authenticated user instead of a client-supplied userId', async () => {
      const { app, redeem } = createTestApp();
      const token = await tokenFor(userId);

      const response = await request(app)
        .post('/coupons/redeem')
        .set('authorization', `Bearer ${token}`)
        .send({
          couponCode: 'SAVE10',
          rideId,
          fareAmount: 10000,
          userId: otherUserId,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(redeem).not.toHaveBeenCalled();
    });

    it('rejects missing required fields', async () => {
      const { app, redeem } = createTestApp();
      const token = await tokenFor(userId);

      const response = await request(app)
        .post('/coupons/redeem')
        .set('authorization', `Bearer ${token}`)
        .send({
          couponCode: 'SAVE10',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(redeem).not.toHaveBeenCalled();
    });

    it('rejects invalid rideId', async () => {
      const { app, redeem } = createTestApp();
      const token = await tokenFor(userId);

      const response = await request(app)
        .post('/coupons/redeem')
        .set('authorization', `Bearer ${token}`)
        .send({
          couponCode: 'SAVE10',
          rideId: 'not-a-uuid',
          fareAmount: 10000,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(redeem).not.toHaveBeenCalled();
    });

    it('rejects invalid fare amounts', async () => {
      const { app, redeem } = createTestApp();
      const token = await tokenFor(userId);

      const response = await request(app)
        .post('/coupons/redeem')
        .set('authorization', `Bearer ${token}`)
        .send({
          couponCode: 'SAVE10',
          rideId,
          fareAmount: -1,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(redeem).not.toHaveBeenCalled();
    });

    it('rejects unexpected request fields', async () => {
      const { app, redeem } = createTestApp();
      const token = await tokenFor(userId);

      const response = await request(app)
        .post('/coupons/redeem')
        .set('authorization', `Bearer ${token}`)
        .send({
          couponCode: 'SAVE10',
          rideId,
          fareAmount: 10000,
          admin: true,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(redeem).not.toHaveBeenCalled();
    });

    it('trims the coupon code before passing it to the service', async () => {
      const { app, redeem } = createTestApp();
      const token = await tokenFor(userId);

      const response = await request(app)
        .post('/coupons/redeem')
        .set('authorization', `Bearer ${token}`)
        .send({
          couponCode: '  SAVE10  ',
          rideId,
          fareAmount: 10000,
        });

      expect(response.status).toBe(200);

      expect(redeem).toHaveBeenCalledWith({
        couponCode: 'SAVE10',
        userId,
        rideId,
        fareAmount: 10000,
      });
    });
  });
});
