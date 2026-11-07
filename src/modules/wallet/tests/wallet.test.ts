import { PostgresPaymentRepository } from '../../payments/repositories/payment.repository.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PostgresWalletRepository } from '../repositories/wallet.repository.js';
import { pool } from '../../../infrastructure/database/postgres.js';

describe('PostgresWalletRepository', () => {
  const repo = new PostgresWalletRepository(pool);
  const recipientId = '22222222-2222-3333-4444-555555555555';
  const testUserId = '11111111-2222-3333-4444-555555555555';

  beforeEach(async () => {
    // Ensure test user exists in users table
    await pool.query(
      `INSERT INTO users (id, first_name, last_name, phone, role, status)
       VALUES ($1, 'Wallet', 'Tester', '+919999988888', 'customer', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [testUserId],
    );
    await pool.query('DELETE FROM payments WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM rides WHERE customer_id = $1', [testUserId]);
    await pool.query(
      `INSERT INTO users(id,first_name,last_name,phone,role,status) VALUES ($1,'Wallet','Recipient','+919999988887','customer','active') ON CONFLICT(id) DO NOTHING`,
      [recipientId],
    );
    // Clean up wallet entries for test user
    await pool.query('DELETE FROM user_wallet_entries WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM user_wallets WHERE user_id = $1', [testUserId]);
  });

  afterEach(async () => {
    await pool.query('DELETE FROM user_wallet_entries WHERE user_id=$1', [recipientId]);
    await pool.query('DELETE FROM user_wallets WHERE user_id=$1', [recipientId]);
    await pool.query('DELETE FROM users WHERE id=$1', [recipientId]);
    await pool.query('DELETE FROM payments WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM rides WHERE customer_id = $1', [testUserId]);
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
      50000, // â‚¹500.00
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
    expect(history.transactions[0]!.type).toBe('credit');
    expect(history.transactions[0]!.amount).toBe(500.0);
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
        25000, // â‚¹250.00
        { type: 'merchant', id: recipientId },
        'idem_pay_fail',
      ),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });

    const wallet = await repo.getWallet(testUserId);
    expect(wallet.balance).toBe(0.0);
  });

  it('completes debit payment, updates ledger, and prevents double debit replay', async () => {
    // Add â‚¹1,000
    await repo.topUp(testUserId, 100000, 'UPI', 'ref_add_1000', 'idem_add_1000');

    // Pay â‚¹350
    const payResult = await repo.pay(
      testUserId,
      35000,
      { type: 'merchant', id: recipientId, name: 'Fresh Groceries' },
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
      { type: 'merchant', id: recipientId },
      'idem_pay_350',
    );

    expect(replay.transactionId).toBe(payResult.transactionId);
    expect(replay.balanceAfter).toBe(650.0);

    const finalWallet = await repo.getWallet(testUserId);
    expect(finalWallet.balance).toBe(650.0);

    const history = await repo.getHistory(testUserId, { type: 'debit' });
    expect(history.totalCount).toBe(1);
    expect(history.transactions[0]!.type).toBe('debit');
    expect(history.transactions[0]!.amount).toBe(350.0);
  });

  it('rejects external transfers without debiting a wallet', async () => {
    await repo.topUp(testUserId, 100000, 'CASHFREE', 'fixture', 'external_seed');
    await expect(
      repo.pay(testUserId, 50000, { type: 'upi', id: 'merchant@bank' }, 'external'),
    ).rejects.toMatchObject({ code: 'EXTERNAL_TRANSFER_UNAVAILABLE' });
    expect((await repo.getWallet(testUserId)).balancePaise).toBe(100000);
  });

  it('captures concurrent wallet retries once against the customer balance', async () => {
    await repo.topUp(testUserId, 100000, 'CASHFREE', 'verified_fixture', 'capture_seed');
    const payments = new PostgresPaymentRepository(pool);
    const ride = (
      await pool.query<{ id: string }>(
        `INSERT INTO rides(customer_id,pickup_location,destination_location) VALUES ($1,ST_SetSRID(ST_MakePoint(85.1,25.6),4326),ST_SetSRID(ST_MakePoint(85.2,25.7),4326)) RETURNING id`,
        [testUserId],
      )
    ).rows[0]!;
    const payment = await payments.initiate({
      rideId: ride.id,
      userId: testUserId,
      amount: 350,
      currency: 'INR',
      provider: 'wallet',
    });
    const results = await Promise.all([
      payments.captureWallet(payment.id, testUserId, 350),
      payments.captureWallet(payment.id, testUserId, 350),
    ]);
    expect(results.every((p) => p.status === 'CAPTURED')).toBe(true);
    expect((await repo.getWallet(testUserId)).balancePaise).toBe(65000);
    expect((await repo.getHistory(testUserId, { type: 'debit' })).totalCount).toBe(1);
  });

  it('credits whole-rupee partial and final refunds once, preserving the original charge', async () => {
    await repo.topUp(testUserId, 100000, 'CASHFREE', 'fixture', 'refund_seed');
    const payments = new PostgresPaymentRepository(pool);
    const ride = (
      await pool.query<{ id: string }>(
        `INSERT INTO rides(customer_id,pickup_location,destination_location)
      VALUES($1,ST_SetSRID(ST_MakePoint(85.1,25.6),4326),ST_SetSRID(ST_MakePoint(85.2,25.7),4326)) RETURNING id`,
        [testUserId],
      )
    ).rows[0]!;
    const payment = await payments.initiate({
      rideId: ride.id,
      userId: testUserId,
      amount: 350,
      currency: 'INR',
      provider: 'wallet',
    });
    await payments.captureWallet(payment.id, testUserId, 350);
    const partials = await Promise.all([
      payments.refund(payment.id, 150, 'partial', 0),
      payments.refund(payment.id, 150, 'replay', 0),
    ]);
    expect(partials.filter(Boolean)).toHaveLength(1);
    expect(partials.find(Boolean)?.status).toBe('CAPTURED');
    expect((await repo.getWallet(testUserId)).balancePaise).toBe(80000);
    expect(await payments.refund(payment.id, 201, 'exceeds balance', 150)).toBeNull();
    const final = await payments.refund(payment.id, 200, 'remaining', 150);
    expect(final?.status).toBe('REFUNDED');
    expect(Number(final?.amount)).toBe(350);
    expect(Number(final?.refundedAmount)).toBe(350);
    expect((await repo.getWallet(testUserId)).balancePaise).toBe(100000);
    const ledger = await pool.query(
      'SELECT amount,status FROM payment_refunds WHERE payment_id=$1 ORDER BY amount',
      [payment.id],
    );
    expect(ledger.rows.map((row) => [Number(row.amount), row.status])).toEqual([
      [150, 'SUCCESS'],
      [200, 'SUCCESS'],
    ]);
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
