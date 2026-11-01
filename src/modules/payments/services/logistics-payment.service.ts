import type { Pool, PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { PaymentProvider } from '../providers/payment.provider.js';
export class LogisticsPaymentService {
  constructor(
    private readonly pool: Pool,
    private readonly payments: PaymentRepository,
    private readonly provider?: PaymentProvider,
  ) {}
  async access(
    rideId: string,
    userId: string,
    role: string,
    client: Pool | PoolClient = this.pool,
  ) {
    const row = (
      await client.query(
        `SELECT r.*,dp.user_id AS driver_user_id,lp.total_paise,lp.upfront_paise,lp.final_paise FROM rides r JOIN logistics_ride_payment_plans lp ON lp.ride_id=r.id LEFT JOIN driver_profiles dp ON dp.id=r.assigned_driver_id WHERE r.id=$1`,
        [rideId],
      )
    ).rows[0];
    if (!row)
      throw new AppError('LOGISTICS_PAYMENT_NOT_FOUND', 'Logistics payment plan not found', 404);
    if (
      row.customer_id !== userId &&
      row.driver_user_id !== userId &&
      !['admin', 'super_admin'].includes(role)
    )
      throw new AppError('FORBIDDEN', 'Booking payment access denied', 403);
    return row;
  }
  async hasPlan(rideId: string) {
    return Boolean(
      (
        await this.pool.query('SELECT 1 FROM logistics_ride_payment_plans WHERE ride_id=$1', [
          rideId,
        ])
      ).rowCount,
    );
  }
  async summary(rideId: string, userId: string, role: string) {
    const ride = await this.access(rideId, userId, role);
    const payments = await this.payments.findByRideId(rideId);
    const confirmed = payments
      .filter((p) => p.status === 'CAPTURED')
      .reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
    const total = Number(ride.total_paise),
      upfront = Number(ride.upfront_paise);
    return {
      rideId,
      currency: 'INR',
      totalPaise: total,
      upfrontPaise: upfront,
      finalPaise: Number(ride.final_paise),
      confirmedPaise: confirmed,
      outstandingPaise: Math.max(0, total - confirmed),
      upfrontConfirmed: payments.some(
        (p) => p.paymentStage === 'upfront' && p.status === 'CAPTURED',
      ),
      deliveryStatus: ride.status,
      settlementStatus: confirmed >= total ? 'settled' : 'outstanding',
      payments,
    };
  }
  async initiate(
    rideId: string,
    userId: string,
    role: string,
    input: {
      stage?: 'upfront' | 'final' | undefined;
      provider: string;
      idempotencyKey?: string | undefined;
      currency?: string | undefined;
    },
  ) {
    const client = await this.pool.connect();
    let payment;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM rides WHERE id=$1 FOR UPDATE', [rideId]);
      const ride = await this.access(rideId, userId, role, client);
      if (ride.customer_id !== userId)
        throw new AppError('FORBIDDEN', 'Only the booking customer can initiate payment', 403);
      if (
        !['cash', 'cashfree'].includes(input.provider) ||
        (input.currency && input.currency !== 'INR')
      )
        throw new AppError(
          'LOGISTICS_PAYMENT_METHOD',
          'Use cash or verified Cashfree payment in INR',
          422,
        );
      if (input.provider === 'cashfree' && !this.provider)
        throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Cashfree is unavailable', 503);
      if (ride.status === 'cancelled')
        throw new AppError('PAYMENT_STAGE_STATE', 'Cancelled bookings cannot accept payments', 409);
      const stage = input.stage ?? (ride.status === 'completed' ? 'final' : 'upfront');
      const previous = (
        await client.query(
          `SELECT * FROM payments WHERE ride_id=$1 AND payment_stage=$2 AND status IN ('INITIATED','AUTHORIZED','CAPTURED') ORDER BY created_at DESC LIMIT 1`,
          [rideId, stage],
        )
      ).rows[0];
      if (previous) {
        if (previous.provider !== input.provider)
          throw new AppError(
            'PAYMENT_STAGE_CONFLICT',
            'A payment already exists for this stage',
            409,
          );
        payment = await this.payments.findById(previous.id);
      } else {
        if (
          stage === 'upfront' &&
          !['driver_assigned', 'driver_arriving', 'driver_arrived'].includes(ride.status)
        )
          throw new AppError(
            'PAYMENT_STAGE_STATE',
            'Upfront payment starts after driver acceptance and before pickup',
            409,
          );
        if (
          stage === 'final' &&
          (ride.status !== 'completed' ||
            !(
              await client.query(
                "SELECT 1 FROM payments WHERE ride_id=$1 AND payment_stage='upfront' AND status='CAPTURED'",
                [rideId],
              )
            ).rowCount)
        )
          throw new AppError(
            'PAYMENT_STAGE_STATE',
            'Final balance is payable after delivery and confirmed upfront payment',
            409,
          );
        const amount = Number(stage === 'upfront' ? ride.upfront_paise : ride.final_paise) / 100;
        const inserted = await client.query(
          `INSERT INTO payments(user_id,ride_id,amount,currency,provider,status,payment_stage,idempotency_key) VALUES($1,$2,$3,'INR',$4,'INITIATED',$5,$6) RETURNING id`,
          [userId, rideId, amount, input.provider, stage, input.idempotencyKey ?? null],
        );
        await client.query(
          `INSERT INTO logistics_payment_events(payment_id,actor_id,event_type,metadata) VALUES($1,$2,'initiated',$3::jsonb)`,
          [inserted.rows[0].id, userId, JSON.stringify({ stage, amount })],
        );
        // Read after committing so repository calls use the committed row.
        payment = { id: inserted.rows[0].id };
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const stored = await this.payments.findById(payment!.id);
    if (!stored) throw new Error('Payment missing after initiation');
    let paymentSessionId: string | null = null;
    if (stored.provider === 'cashfree' && stored.status !== 'CAPTURED') {
      const order = await this.provider!.createOrder({
        orderId: 'order_' + stored.id,
        amount: Number(stored.amount),
        currency: stored.currency,
        customerId: userId,
        orderNote: 'INFURNUS Logistics ' + stored.paymentStage,
      });
      if (
        order.providerOrderId !== 'order_' + stored.id ||
        order.orderCurrency !== stored.currency ||
        Math.round(order.orderAmount * 100) !== Math.round(Number(stored.amount) * 100)
      )
        throw new AppError(
          'PAYMENT_ORDER_MISMATCH',
          'Cashfree order does not match this payment',
          502,
        );
      await this.payments.updateProviderOrder!(stored.id, order.providerOrderId);
      stored.providerOrderId = order.providerOrderId;
      paymentSessionId = order.paymentSessionId ?? null;
    }
    return { ...stored, paymentSessionId };
  }
  async claim(paymentId: string, userId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const p = (await client.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId]))
        .rows[0];
      if (!p || !p.payment_stage)
        throw new AppError('PAYMENT_NOT_FOUND', 'Staged payment not found', 404);
      if (p.user_id !== userId)
        throw new AppError('FORBIDDEN', 'Only the booking customer can submit this claim', 403);
      const ride = (await client.query('SELECT status FROM rides WHERE id=$1', [p.ride_id]))
        .rows[0];
      if (ride?.status === 'cancelled')
        throw new AppError(
          'PAYMENT_STAGE_STATE',
          'Cancelled bookings cannot accept payment claims',
          409,
        );
      if (p.status === 'FAILED' || p.status === 'REFUNDED')
        throw new AppError('PAYMENT_STATE', 'Payment cannot be claimed in its current state', 409);
      if (!p.customer_claimed_at) {
        await client.query(
          'UPDATE payments SET customer_claimed_at=NOW(),updated_at=NOW() WHERE id=$1',
          [paymentId],
        );
        await client.query(
          "INSERT INTO logistics_payment_events(payment_id,actor_id,event_type) VALUES($1,$2,'customer_claimed')",
          [paymentId, userId],
        );
      }
      await client.query('COMMIT');
      return await this.payments.findById(paymentId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async confirmCash(paymentId: string, userId: string, role: string) {
    const p = await this.payments.findById(paymentId);
    if (!p?.rideId || !p.paymentStage)
      throw new AppError('PAYMENT_NOT_FOUND', 'Staged payment not found', 404);
    const ride = await this.access(p.rideId, userId, role);
    if (role !== 'driver' || ride.driver_user_id !== userId || p.provider !== 'cash')
      throw new AppError('FORBIDDEN', 'Only the assigned driver can confirm cash received', 403);
    if (!p.customerClaimedAt)
      throw new AppError(
        'PAYMENT_CLAIM_REQUIRED',
        'Customer must submit the cash payment claim first',
        409,
      );
    return this.payments.capture({ paymentId, cashConfirmedBy: userId });
  }
}
