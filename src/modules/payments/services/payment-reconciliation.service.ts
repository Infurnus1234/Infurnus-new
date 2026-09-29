import type { Pool } from 'pg';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { PaymentProvider } from '../providers/payment.provider.js';

export class PaymentReconciliationService {
  constructor(
    private readonly pool: Pool,
    private readonly paymentRepository: PaymentRepository,
    private readonly paymentProvider?: PaymentProvider,
  ) {}

  async reconcileStuckPayments(staleMinutes: number = 10): Promise<{ reconciled: number; failed: number }> {
    const result = await this.pool.query<{ id: string; providerOrderId: string; provider: string }>(
      `SELECT id, provider_order_id AS "providerOrderId", provider
       FROM payments
       WHERE status = 'INITIATED'
         AND created_at < NOW() - (INTERVAL '1 minute' * $1)`,
      [staleMinutes],
    );

    let reconciled = 0;
    let failed = 0;

    for (const payment of result.rows) {
      if (!payment.providerOrderId || !this.paymentProvider) continue;

      try {
        const providerStatus = await this.paymentProvider.getPaymentStatus(payment.providerOrderId);

        if (providerStatus.status === 'PAID') {
          await this.paymentRepository.capture({
            paymentId: payment.id,
            providerPaymentId: providerStatus.providerPaymentId,
          });
          reconciled++;
        } else if (providerStatus.status === 'FAILED' || providerStatus.status === 'EXPIRED') {
          if (this.paymentRepository.markFailed) {
            await this.paymentRepository.markFailed(payment.id, providerStatus.failureReason ?? 'Payment expired or failed at gateway');
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
