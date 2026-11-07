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

it('uses the same backend rounded amount for wallet quote, stored top-up and checkout', async () => {
  const f=fixture();
  const stored={...f.repo,createTopUpOrder:vi.fn().mockResolvedValue({orderId:'wallet_order',amountPaise:'100100'})};
  f.provider.createOrder.mockResolvedValue({providerOrderId:'wallet_order',paymentSessionId:'local-test-session',orderCurrency:'INR',orderAmount:1001});
  const c=new WalletController(stored as unknown as PostgresWalletRepository,f.provider as PaymentProvider);
  f.req.body={amount:1000.50}; c.quotePayment(f.req,f.res,f.next);
  expect(f.res.json).toHaveBeenCalledWith({success:true,data:{amount:1001,currency:'INR'}});
  f.req.body={amount:1000.50,idempotencyKey:'rounded-order'};
  await c.initiateTopUp(f.req,f.res,f.next); expect(f.next).not.toHaveBeenCalled();
  expect(stored.createTopUpOrder).toHaveBeenCalledWith('customer',100100,'rounded-order',100050);
  expect(f.provider.createOrder).toHaveBeenCalledWith(expect.objectContaining({amount:1001}));
  expect(f.res.json).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({amount:1001,amountPaise:100100})}));
});

it('reuses the exact stored amount when retrying a historical top-up',async()=>{
  const f=fixture();
  const stored={...f.repo,createTopUpOrder:vi.fn().mockResolvedValue({orderId:'wallet_order',amountPaise:'100050'})};
  f.provider.createOrder.mockResolvedValue({providerOrderId:'wallet_order',paymentSessionId:'existing-test-session',orderCurrency:'INR',orderAmount:1000.5});
  const c=new WalletController(stored as unknown as PostgresWalletRepository,f.provider as PaymentProvider);
  f.req.body={amount:1000.50,idempotencyKey:'historical-order'};
  await c.initiateTopUp(f.req,f.res,f.next); expect(f.next).not.toHaveBeenCalled();
  expect(f.provider.createOrder).toHaveBeenCalledWith(expect.objectContaining({amount:1000.5}));
  expect(f.res.json).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({amount:1000.5,amountPaise:100050})}));
});
