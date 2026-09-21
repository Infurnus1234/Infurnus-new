import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { ProviderBankRepository } from '../repositories/provider-bank.repository.js';
import type { ProviderBankAccount } from '../types/provider.js';

class MockProviderBankRepository implements ProviderBankRepository {
  getBankAccount = vi.fn().mockImplementation(async (userId: string) => ({
    id: '11111111-e29b-41d4-a716-446655440000',
    userId,
    accountHolderName: 'Abhishek Kumar',
    accountNumberMasked: '••••••••1234',
    accountNumberLast4: '1234',
    ifscCode: 'SBIN0001234',
    bankName: 'State Bank of India',
    upiId: 'abhi@okhdfcbank',
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ProviderBankAccount));

  upsertBankAccount = vi.fn().mockImplementation(async (userId: string, input) => ({
    id: '11111111-e29b-41d4-a716-446655440000',
    userId,
    accountHolderName: input.accountHolderName,
    accountNumberMasked: `••••••••${input.accountNumber.slice(-4)}`,
    accountNumberLast4: input.accountNumber.slice(-4),
    ifscCode: input.ifscCode,
    bankName: input.bankName,
    upiId: input.upiId ?? null,
    isVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ProviderBankAccount));
}

describe('Provider Bank Account API', () => {
  const bankRepo = new MockProviderBankRepository();
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
    undefined,
    undefined,
    undefined,
    undefined,
    bankRepo,
  );

  const driverId = '770e8400-e29b-41d4-a716-446655440000';

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/provider/bank-account');
    expect(res.status).toBe(401);
  });

  it('retrieves masked bank account details for driver', async () => {
    const token = await signAccessToken({ sub: driverId, role: 'driver', type: 'access' });
    const res = await request(app)
      .get('/provider/bank-account')
      .set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountNumberMasked).toBe('••••••••1234');
    expect(res.body.data.accountHolderName).toBe('Abhishek Kumar');
    // Ensure raw account number is never present
    expect(res.body.data.accountNumber).toBeUndefined();
    expect(res.body.data.account_number).toBeUndefined();
  });

  it('upserts bank account details', async () => {
    const token = await signAccessToken({ sub: driverId, role: 'driver', type: 'access' });
    const res = await request(app)
      .post('/provider/bank-account')
      .set('authorization', `Bearer ${token}`)
      .send({
        accountHolderName: 'Abhishek Kumar',
        accountNumber: '987654321012',
        ifscCode: 'HDFC0000123',
        bankName: 'HDFC Bank',
        upiId: 'abhishek@hdfc',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountNumberMasked).toBe('••••••••1012');
    expect(res.body.data.bankName).toBe('HDFC Bank');
  });
});
