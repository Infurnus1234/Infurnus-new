import type { Pool } from 'pg';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { PaymentProvider } from '../providers/payment.provider.js';

export class PaymentReconciliationService {
  constructor(
    private readonly pool: Pool,
    private readonly paymentRepository: PaymentRepository,
    private readonly paymentProvider?: PaymentProvider,
  ) {}

  async reconcileStuckPayments(
    staleMinutes: number = 10,
  ): Promise<{ reconciled: number; failed: number }> {
    const result = await this.pool.query<{
      id: string;
      providerOrderId: string;
      provider: string;
      amount: string;
      currency: string;
      payment_stage: string | null;
    }>(
      `SELECT id, amount, currency, payment_stage, provider_order_id AS "providerOrderId", provider
       FROM payments
       WHERE status = 'INITIATED'
         AND created_at < NOW() - (INTERVAL '1 minute' * $1)`,
      [staleMinutes],
    );

    let reconciled = 0;
    let failed = 0;

    for (const payment of result.rows) {
      if (payment.provider !== 'cashfree' || !payment.providerOrderId || !this.paymentProvider)
        continue;

      try {
        const providerStatus = await this.paymentProvider.getPaymentStatus(payment.providerOrderId);

        if (
          payment.payment_stage &&
          (providerStatus.providerOrderId !== payment.providerOrderId ||
            providerStatus.orderCurrency !== payment.currency ||
            Math.round(Number(providerStatus.orderAmount) * 100) !==
              Math.round(Number(payment.amount) * 100) ||
            !providerStatus.providerPaymentId)
        )
          continue;
        if (providerStatus.orderStatus === 'PAID') {
          await this.paymentRepository.capture({
            paymentId: payment.id,
            providerPaymentId: providerStatus.providerPaymentId ?? undefined,
            ...(payment.payment_stage ? { verifiedOnline: true } : {}),
          });
          reconciled++;
        } else if (
          providerStatus.orderStatus === 'FAILED' ||
          providerStatus.orderStatus === 'EXPIRED'
        ) {
          if (this.paymentRepository.markFailed) {
            await this.paymentRepository.markFailed(
              payment.id,
              providerStatus.rawStatus ?? 'Payment expired or failed at gateway',
            );
          }
          failed++;
        }
      } catch (err) {
        console.error(`[RECONCILIATION] Failed to reconcile payment ${payment.id}:`, err);
      }
    }

    return { reconciled, failed };
  }
}
