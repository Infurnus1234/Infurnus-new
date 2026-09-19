import type { Pool } from 'pg';
import type { CapturePaymentData, InitiatePaymentData, Payment } from '../types/payment.js';

export interface PaymentRepository {
  initiate(data: InitiatePaymentData): Promise<Payment>;
  capture(data: CapturePaymentData): Promise<Payment | null>;
  findById(id: string): Promise<Payment | null>;
  findByRideId(rideId: string): Promise<Payment[]>;
  findActiveByRideId(rideId: string): Promise<Payment | null>;
  listForUser(userId: string, limit?: number): Promise<Payment[]>;
  updateProviderOrder?(paymentId: string, providerOrderId: string): Promise<Payment | null>;
  findByProviderOrderId?(providerOrderId: string): Promise<Payment | null>;
  markFailed?(paymentId: string, failureReason?: string): Promise<Payment | null>;
  refund?(paymentId: string, refundAmount: number, reason?: string): Promise<Payment | null>;
}

const paymentProjection = `
  id, user_id AS "userId", ride_id AS "rideId",
  rental_id AS "rentalId", logistics_order_id AS "logisticsOrderId",
  status, amount::numeric AS "amount", currency, provider,
  provider_order_id AS "providerOrderId", provider_payment_id AS "providerPaymentId",
  idempotency_key AS "idempotencyKey", initiated_at AS "initiatedAt",
  authorized_at AS "authorizedAt", captured_at AS "capturedAt",
  refunded_at AS "refundedAt", failed_at AS "failedAt",
  failure_reason AS "failureReason", created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export class PostgresPaymentRepository implements PaymentRepository {
  constructor(private readonly pool: Pool) {}

  async initiate(data: InitiatePaymentData): Promise<Payment> {
    const result = await this.pool.query<Payment>(
      `INSERT INTO payments (
         user_id, ride_id, rental_id, logistics_order_id,
         amount, currency, provider, idempotency_key, provider_order_id, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'INITIATED')
       RETURNING ${paymentProjection}`,
      [
        data.userId,
        data.rideId ?? null,
        data.rentalId ?? null,
        data.logisticsOrderId ?? null,
        data.amount,
        data.currency ?? 'INR',
        data.provider ?? 'wallet',
        data.idempotencyKey ?? null,
        data.providerOrderId ?? null,
      ],
    );

    const payment = result.rows[0];
    if (!payment) throw new Error('Failed to initiate payment');
    return payment;
  }

  async updateProviderOrder(paymentId: string, providerOrderId: string): Promise<Payment | null> {
    const result = await this.pool.query<Payment>(
      `UPDATE payments
       SET provider_order_id = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${paymentProjection}`,
      [paymentId, providerOrderId],
    );

    return result.rows[0] ?? null;
  }

  async capture(data: CapturePaymentData): Promise<Payment | null> {
    const result = await this.pool.query<Payment>(
      `UPDATE payments
       SET status = 'CAPTURED',
           captured_at = NOW(),
           authorized_at = COALESCE(authorized_at, NOW()),
           provider_payment_id = COALESCE($2, provider_payment_id, gen_random_uuid()::text),
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${paymentProjection}`,
      [data.paymentId, data.providerPaymentId ?? null],
    );

    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<Payment | null> {
    const result = await this.pool.query<Payment>(
      `SELECT ${paymentProjection} FROM payments WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByRideId(rideId: string): Promise<Payment[]> {
    const result = await this.pool.query<Payment>(
      `SELECT ${paymentProjection} FROM payments WHERE ride_id = $1 ORDER BY created_at DESC`,
      [rideId],
    );
    return result.rows;
  }

  async findActiveByRideId(rideId: string): Promise<Payment | null> {
    const result = await this.pool.query<Payment>(
      `SELECT ${paymentProjection}
       FROM payments
       WHERE ride_id = $1 AND status IN ('INITIATED', 'AUTHORIZED', 'CAPTURED')
       ORDER BY created_at DESC
       LIMIT 1`,
      [rideId],
    );
    return result.rows[0] ?? null;
  }

  async listForUser(userId: string, limit: number = 20): Promise<Payment[]> {
    const result = await this.pool.query<Payment>(
      `SELECT ${paymentProjection}
       FROM payments
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows;
  }

  async findByProviderOrderId(providerOrderId: string): Promise<Payment | null> {
    const result = await this.pool.query<Payment>(
      `SELECT ${paymentProjection}
       FROM payments
       WHERE provider_order_id = $1 OR id::text = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [providerOrderId],
    );
    return result.rows[0] ?? null;
  }

  async markFailed(paymentId: string, failureReason?: string): Promise<Payment | null> {
    const result = await this.pool.query<Payment>(
      `UPDATE payments
       SET status = 'FAILED',
           failed_at = NOW(),
           failure_reason = COALESCE($2, failure_reason, 'Payment failed'),
           updated_at = NOW()
       WHERE id = $1 AND status != 'CAPTURED'
       RETURNING ${paymentProjection}`,
      [paymentId, failureReason ?? null],
    );
    return result.rows[0] ?? null;
  }

  async refund(paymentId: string, _refundAmount: number, reason?: string): Promise<Payment | null> {
    const result = await this.pool.query<Payment>(
      `UPDATE payments
       SET status = 'REFUNDED',
           refunded_at = NOW(),
           failure_reason = COALESCE($2, failure_reason),
           updated_at = NOW()
       WHERE id = $1 AND status = 'CAPTURED'
       RETURNING ${paymentProjection}`,
      [paymentId, reason ?? null],
    );
    return result.rows[0] ?? null;
  }
}
