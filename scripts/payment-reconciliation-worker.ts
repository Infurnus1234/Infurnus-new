import { env } from '../src/config/env.js';
import { pool } from '../src/infrastructure/database/postgres.js';
import { PostgresPaymentRepository } from '../src/modules/payments/repositories/payment.repository.js';
import { CashfreePaymentProvider } from '../src/modules/payments/providers/cashfree.provider.js';
import { PaymentReconciliationService } from '../src/modules/payments/services/payment-reconciliation.service.js';

async function runWorker() {
  console.log('[WORKER] Payment reconciliation worker started...');
  const repo = new PostgresPaymentRepository(pool);

  const cashfreeConfig = {
    clientId: env.CASHFREE_CLIENT_ID || 'TEST_CLIENT_ID',
    clientSecret: env.CASHFREE_CLIENT_SECRET || 'TEST_CLIENT_SECRET',
    baseUrl: env.CASHFREE_BASE_URL || 'https://sandbox.cashfree.com/pg',
    apiVersion: env.CASHFREE_API_VERSION || '2023-08-01',
  };

  const provider = new CashfreePaymentProvider(cashfreeConfig);
  const service = new PaymentReconciliationService(pool, repo, provider);

  try {
    const stats = await service.reconcileStuckPayments(10);
    console.log(`[WORKER] Reconciliation complete. Reconciled: ${stats.reconciled}, Failed: ${stats.failed}`);
  } catch (err) {
    console.error('[WORKER] Error in reconciliation worker:', err);
  } finally {
    process.exit(0);
  }
}

runWorker();
