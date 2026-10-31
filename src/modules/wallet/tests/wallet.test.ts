import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostgresWalletRepository } from '../repositories/wallet.repository.js';
import { pool } from '../../../infrastructure/database/postgres.js';

describe('PostgresWalletRepository', () => {
  const repo = new PostgresWalletRepository(pool);
  const testUserId = '11111111-2222-3333-4444-555555555555';

  beforeEach(async () => {
    // Ensure test user exists in users table
    await pool.query(
      `INSERT INTO users (id, first_name, last_name, phone, role, status)
       VALUES ($1, 'Wallet', 'Tester', '+919999988888', 'customer', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [testUserId],
    );
    // Clean up wallet entries for test user
    await pool.query('DELETE FROM user_wallet_entries WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM user_wallets WHERE user_id = $1', [testUserId]);
  });

  afterEach(async () => {
    await pool.query('DELETE FROM user_wallet_entries WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM user_wallets WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
  });

  it('initializes a fresh wallet with 0 balance and 0 activities', async () => {
    const wallet = await repo.getWallet(testUserId);
    expect(wallet.balance).toBe(0.0);
    expect(wallet.balancePaise).toBe(0);
    expect(wallet.currency).toBe('INR');
    expect(wallet.isActive).toBe(true);
    expect(wallet.activityCount).toBe(0);
  });

  it('credits top-up amount accurately in integer paise and returns history', async () => {
    const topup1 = await repo.topUp(
      testUserId,
      50000, // ₹500.00
      'UPI',
      'ref_topup_1',
      'idem_topup_1',
      'Google Pay Top-Up',
    );

    expect(topup1.wallet.balance).toBe(500.0);
    expect(topup1.wallet.balancePaise).toBe(50000);
    expect(topup1.entry.amount).toBe(500.0);
    expect(topup1.entry.status).toBe('COMPLETED');

    const history = await repo.getHistory(testUserId);
    expect(history.totalCount).toBe(1);
    expect(history.transactions[0].type).toBe('credit');
    expect(history.transactions[0].amount).toBe(500.0);
  });

  it('prevents duplicate top-up credits on identical idempotency key replay', async () => {
    const first = await repo.topUp(
      testUserId,
      50000,
      'UPI',
      'ref_topup_first',
      'idem_replay_key_1',
    );
    expect(first.wallet.balance).toBe(500.0);

    // Replay with identical key
    const replay = await repo.topUp(
      testUserId,
      50000,
      'UPI',
      'ref_topup_first',
      'idem_replay_key_1',
    );

    // Wallet balance must stay 500.0, NOT 1000.0
    const wallet = await repo.getWallet(testUserId);
    expect(wallet.balance).toBe(500.0);
    expect(replay.entry.id).toBe(first.entry.id);
  });

  it('blocks payment debit when wallet balance is insufficient', async () => {
    // Balance is 0
    await expect(
      repo.pay(
        testUserId,
        25000, // ₹250.00
        { type: 'merchant', id: 'STORE123' },
        'idem_pay_fail',
      ),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });

    const wallet = await repo.getWallet(testUserId);
    expect(wallet.balance).toBe(0.0);
  });

  it('completes debit payment, updates ledger, and prevents double debit replay', async () => {
    // Add ₹1,000
    await repo.topUp(testUserId, 100000, 'UPI', 'ref_add_1000', 'idem_add_1000');

    // Pay ₹350
    const payResult = await repo.pay(
      testUserId,
      35000,
      { type: 'merchant', id: 'MERCHANT_ABC', name: 'Fresh Groceries' },
      'idem_pay_350',
      'Groceries delivery',
    );

    expect(payResult.status).toBe('COMPLETED');
    expect(payResult.balanceAfter).toBe(650.0);
    expect(payResult.balanceAfterPaise).toBe(65000);

    // Replay payment request with identical idempotency key
    const replay = await repo.pay(
      testUserId,
      35000,
      { type: 'merchant', id: 'MERCHANT_ABC' },
      'idem_pay_350',
    );

    expect(replay.transactionId).toBe(payResult.transactionId);
    expect(replay.balanceAfter).toBe(650.0);

    const finalWallet = await repo.getWallet(testUserId);
    expect(finalWallet.balance).toBe(650.0);

    const history = await repo.getHistory(testUserId, { type: 'debit' });
    expect(history.totalCount).toBe(1);
    expect(history.transactions[0].type).toBe('debit');
    expect(history.transactions[0].amount).toBe(350.0);
  });

  it('resolves valid and invalid recipient identifiers properly', async () => {
    const validUpi = await repo.resolveRecipient('upi', 'merchant@okaxis');
    expect(validUpi.isVerified).toBe(true);
    expect(validUpi.displayName).toBe('MERCHANT');

    await expect(repo.resolveRecipient('upi', 'invalid-format')).rejects.toMatchObject({
      code: 'INVALID_UPI_ID',
    });
  });
});
