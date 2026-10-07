import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { PostgresProviderFinanceRepository } from '../repositories/provider-finance.repository.js';
import { createProviderFinanceRouter } from '../routes/provider-finance.routes.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Provider finance PostgreSQL integrity',
  () => {
    const repository = new PostgresProviderFinanceRepository(pool);
    let owner: string, other: string, admin: string;
    let app: express.Express;
    beforeEach(async () => {
      const ids = [];
      for (const role of ['driver', 'fleet_owner', 'admin']) {
        const result = await pool.query(
          "INSERT INTO users(first_name,last_name,phone,role) VALUES('Finance','Test',$1,$2) RETURNING id",
          ['+95' + randomUUID().replaceAll('-', '').slice(0, 10), role],
        );
        ids.push(result.rows[0].id as string);
      }
      [owner, other, admin] = ids as [string, string, string];
      await pool.query(
        "INSERT INTO provider_bank_accounts(user_id,account_holder_name,account_number_encrypted,account_number_last4,ifsc_code,bank_name,is_verified) VALUES($1,'Finance Test','test-only','1234','TEST0001234','Test',TRUE)",
        [owner],
      );
      app = express();
      app.use(express.json());
      app.use('/provider', createProviderFinanceRouter(repository));
      app.use(errorMiddleware);
    });
    afterEach(async () => {
      const ids = [owner, other, admin];
      await pool.query('DELETE FROM provider_payouts WHERE user_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM provider_wallet_entries WHERE user_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM provider_wallets WHERE user_id=ANY($1::uuid[])', [ids]);
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [ids],
      );
      await pool.query('DELETE FROM provider_bank_accounts WHERE user_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    });
    const credit = (key = 'earning', amount = 10000) =>
      repository.postAdjustment(admin, owner, amount, 'EARNING', 'settlement-test', key);
    it('serializes duplicate wallet credits and rejects different replay payloads', async () => {
      const result = await Promise.all(Array.from({ length: 12 }, () => credit()));
      expect(new Set(result.map((row) => row.id)).size).toBe(1);
      expect((await repository.wallet(owner, 'driver')).balancePaise).toBe('10000');
      await expect(credit('earning', 10001)).rejects.toMatchObject({ statusCode: 409 });
    });
    it('reserves funds once for concurrent identical payouts and refunds failure once', async () => {
      await credit();
      const result = await Promise.all(
        Array.from({ length: 10 }, () =>
          repository.requestPayout(owner, 'driver', 6000, 'same-payout'),
        ),
      );
      expect(new Set(result.map((row) => row.id)).size).toBe(1);
      expect((await repository.wallet(owner, 'driver')).balancePaise).toBe('4000');
      await repository.transitionPayout(
        admin,
        result[0]!.id,
        'FAILED',
        undefined,
        'Operator declined',
      );
      await repository.transitionPayout(
        admin,
        result[0]!.id,
        'FAILED',
        undefined,
        'Operator declined',
      );
      expect((await repository.wallet(owner, 'driver')).balancePaise).toBe('10000');
      expect((await repository.wallet(owner, 'driver')).entries).toHaveLength(3);
    });
    it('concurrent withdrawals cannot overspend', async () => {
      await credit();
      const result = await Promise.allSettled([
        repository.requestPayout(owner, 'driver', 6000, 'one'),
        repository.requestPayout(owner, 'driver', 6000, 'two'),
      ]);
      expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
      expect((await repository.wallet(owner, 'driver')).balancePaise).toBe('4000');
    });
    it('rejects unauthorized wallet credits and payout processing', async () => {
      await expect(
        repository.postAdjustment(owner, owner, 100, 'EARNING', 'forged', 'forged'),
      ).rejects.toMatchObject({ statusCode: 403 });
      await credit();
      const payout = await repository.requestPayout(owner, 'driver', 100, 'payout');
      await expect(
        repository.transitionPayout(owner, payout.id, 'SUCCESS', 'forged'),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
    it('requires verified bank accounts and freezes pending payout destinations', async () => {
      await credit();
      await pool.query('UPDATE provider_bank_accounts SET is_verified=FALSE WHERE user_id=$1', [
        owner,
      ]);
      await expect(repository.requestPayout(owner, 'driver', 100, 'pending')).rejects.toMatchObject(
        { statusCode: 409 },
      );
      await pool.query('UPDATE provider_bank_accounts SET is_verified=TRUE WHERE user_id=$1', [
        owner,
      ]);
      await repository.requestPayout(owner, 'driver', 100, 'pending');
      await expect(
        pool.query(
          "UPDATE provider_bank_accounts SET account_number_encrypted='different' WHERE user_id=$1",
          [owner],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('requires processing before success and preserves terminal states', async () => {
      await credit();
      const payout = await repository.requestPayout(owner, 'driver', 100, 'success');
      await expect(
        repository.transitionPayout(admin, payout.id, 'SUCCESS', 'provider-1'),
      ).rejects.toMatchObject({ statusCode: 409 });
      await repository.transitionPayout(admin, payout.id, 'PROCESSING');
      await repository.transitionPayout(admin, payout.id, 'SUCCESS', 'provider-' + randomUUID());
      await expect(
        repository.transitionPayout(admin, payout.id, 'FAILED', undefined, 'late'),
      ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('HTTP identity is authenticated; forged owner, balance and approval fields are rejected', async () => {
      await credit();
      const token = await signAccessToken({ sub: other, role: 'fleet_owner', type: 'access' });
      const own = await request(app)
        .get('/provider/wallet')
        .set('authorization', 'Bearer ' + token);
      expect(own.body.data.balancePaise).toBe('0');
      for (const extra of [
        { userId: owner },
        { balancePaise: 10000 },
        { status: 'SUCCESS' },
        { bankAccountId: randomUUID() },
      ]) {
        const response = await request(app)
          .post('/provider/payouts')
          .set('authorization', 'Bearer ' + token)
          .send({ amountPaise: 100, idempotencyKey: 'forged', ...extra });
        expect(response.status).toBe(400);
      }
      expect((await repository.wallet(owner, 'driver')).balancePaise).toBe('10000');
    });
    it('suspended accounts and stale role claims cannot access finances', async () => {
      await expect(repository.wallet(owner, 'fleet_owner')).rejects.toMatchObject({
        statusCode: 403,
      });
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [owner]);
      await expect(repository.wallet(owner, 'driver')).rejects.toMatchObject({ statusCode: 403 });
    });
  },
);
