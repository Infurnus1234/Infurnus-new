import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { WalletController } from '../controllers/wallet.controller.js';
import type { PostgresWalletRepository } from '../repositories/wallet.repository.js';
import type { PaymentProvider } from '../../payments/providers/payment.provider.js';

function fixture(status: Record<string, unknown> = {}) {
  const repo = {
    findTopUpOrder: vi.fn().mockResolvedValue({ orderId: 'wallet_order', amountPaise: '50000' }),
    topUp: vi.fn().mockResolvedValue({ wallet: { balance: 500 } }),
  };
  const provider = {
    providerName: 'cashfree',
    createOrder: vi.fn(),
    getPaymentStatus: vi.fn().mockResolvedValue({
      providerOrderId: 'wallet_order',
      orderStatus: 'PAID',
      orderCurrency: 'INR',
      orderAmount: 500,
      providerPaymentId: 'verified_transaction',
      ...status,
    }),
  };
  const controller = new WalletController(
    repo as unknown as PostgresWalletRepository,
    provider as PaymentProvider,
  );
  const req = {
    auth: { userId: 'customer' },
    body: {
      orderId: 'wallet_order',
      amount: 99999,
      referenceId: 'forged',
      idempotencyKey: 'caller_key',
    },
  } as unknown as Request;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
  return { repo, provider, controller, req, res, next: vi.fn() };
}
describe('wallet gateway verification', () => {
  it('credits only the stored amount and provider reference using a server-controlled replay key', async () => {
    const f = fixture();
    await f.controller.verifyTopUp(f.req, f.res, f.next);
    expect(f.next).not.toHaveBeenCalled();
    expect(f.repo.topUp).toHaveBeenCalledWith(
      'customer',
      50000,
      'CASHFREE',
      'verified_transaction',
      'wallet_order',
      'Verified wallet top-up',
    );
  });
  it.each([
    { orderStatus: 'ACTIVE' },
    { orderCurrency: 'USD' },
    { orderAmount: 1 },
    { providerOrderId: 'other_order' },
    { providerPaymentId: null },
  ])('rejects an unverified or mismatching gateway result %j', async (status) => {
    const f = fixture(status);
    await f.controller.verifyTopUp(f.req, f.res, f.next);
    expect(f.next).toHaveBeenCalled();
    expect(f.repo.topUp).not.toHaveBeenCalled();
  });
  it('rejects orders not owned by this authenticated customer', async () => {
    const f = fixture();
    f.repo.findTopUpOrder.mockResolvedValueOnce(undefined);
    await f.controller.verifyTopUp(f.req, f.res, f.next);
    expect(f.repo.findTopUpOrder).toHaveBeenCalledWith('customer', 'wallet_order');
    expect(f.provider.getPaymentStatus).not.toHaveBeenCalled();
    expect(f.repo.topUp).not.toHaveBeenCalled();
  });
  it('does not credit when the gateway is unavailable', async () => {
    const f = fixture();
    const c = new WalletController(f.repo as unknown as PostgresWalletRepository);
    await c.verifyTopUp(f.req, f.res, f.next);
    expect(f.repo.topUp).not.toHaveBeenCalled();
    expect(f.next).toHaveBeenCalled();
  });
});
