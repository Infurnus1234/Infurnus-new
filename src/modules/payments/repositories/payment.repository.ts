import type { Pool } from 'pg';
import type { CapturePaymentData, InitiatePaymentData, Payment } from '../types/payment.js';

export interface PaymentRepository {
  initiate(data: InitiatePaymentData): Promise<Payment>;
  capture(data: CapturePaymentData): Promise<Payment | null>;
  findById(id: string): Promise<Payment | null>;
  findByRideId(rideId: string): Promise<Payment[]>;
  listForUser(userId: string, limit?: number): Promise<Payment[]>;
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
         amount, currency, provider, idempotency_key, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'INITIATED')
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
      ],
    );

    const payment = result.rows[0];
    if (!payment) throw new Error('Failed to initiate payment');
    return payment;
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
}
