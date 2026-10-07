import type { Pool, PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';

type EntryType = 'EARNING' | 'COMMISSION' | 'ADJUSTMENT' | 'PAYOUT_RESERVE' | 'PAYOUT_REFUND';

export class PostgresProviderFinanceRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async authorize(client: PoolClient, userId: string, role?: string) {
    const result = await client.query(
      `SELECT id FROM users WHERE id = $1 AND status = 'active' AND deleted_at IS NULL
       AND role::text = ANY($2::text[]) FOR SHARE`,
      [userId, role ? [role] : ['driver', 'fleet_owner', 'driver_fleet_owner']],
    );
    if (!result.rowCount) throw new AppError('FORBIDDEN', 'Account is not authorized', 403);
  }

  private async lockWallet(client: PoolClient, userId: string) {
    await client.query('INSERT INTO provider_wallets(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      userId,
    ]);
    const result = await client.query<{ balance_paise: string }>(
      'SELECT balance_paise::text FROM provider_wallets WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    return BigInt(result.rows[0]!.balance_paise);
  }

  private async audit(
    client: PoolClient,
    actorId: string,
    event: string,
    id: string,
    metadata: object,
  ) {
    await client.query(
      `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata)
       VALUES ($1,$2,'provider_finance',$3,$4)`,
      [actorId, event, id, metadata],
    );
  }

  private async entry(
    client: PoolClient,
    userId: string,
    actorId: string,
    amount: bigint,
    balance: bigint,
    type: EntryType,
    reference: string,
    key: string,
  ) {
    const next = balance + amount;
    if (next < 0n) throw new AppError('INSUFFICIENT_BALANCE', 'Insufficient wallet balance', 409);
    await client.query(
      'UPDATE provider_wallets SET balance_paise=$2,updated_at=NOW() WHERE user_id=$1',
      [userId, next.toString()],
    );
    const result = await client.query<{ id: string }>(
      `INSERT INTO provider_wallet_entries(user_id,actor_id,amount_paise,balance_after_paise,entry_type,reference,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [userId, actorId, amount.toString(), next.toString(), type, reference, key],
    );
    await this.audit(client, actorId, 'wallet_entry_created', result.rows[0]!.id, {
      userId,
      amountPaise: amount.toString(),
      type,
      reference,
    });
    return result.rows[0]!;
  }

  // Trusted settlement integration only. There is deliberately no provider-facing
  // credit endpoint. Amounts are integers in paise, never floating-point money.
  async postAdjustment(
    actorId: string,
    userId: string,
    amountPaise: number,
    type: 'EARNING' | 'COMMISSION' | 'ADJUSTMENT',
    reference: string,
    key: string,
  ) {
    if (
      !Number.isSafeInteger(amountPaise) ||
      !amountPaise ||
      Math.abs(amountPaise) > 9999999999 ||
      !reference.trim() ||
      reference.length > 150 ||
      !key.trim() ||
      key.length > 100 ||
      !['EARNING', 'COMMISSION', 'ADJUSTMENT'].includes(type) ||
      (type === 'EARNING' && amountPaise < 0) ||
      (type === 'COMMISSION' && amountPaise > 0)
    ) {
      throw new AppError('INVALID_FINANCIAL_ENTRY', 'Invalid financial entry', 400);
    }
    return this.transaction(async (client) => {
      const actor = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role IN ('admin','super_admin') AND status='active' AND deleted_at IS NULL FOR SHARE",
        [actorId],
      );
      if (!actor.rowCount)
        throw new AppError('FORBIDDEN', 'Settlement actor is not authorized', 403);
      await this.authorize(client, userId);
      const balance = await this.lockWallet(client, userId);
      const prior = await client.query<{
        id: string;
        amount_paise: string;
        entry_type: string;
        reference: string;
      }>(
        'SELECT id,amount_paise::text,entry_type,reference FROM provider_wallet_entries WHERE user_id=$1 AND idempotency_key=$2',
        [userId, key],
      );
      if (prior.rows[0]) {
        const previous = prior.rows[0];
        if (
          previous.amount_paise !== String(amountPaise) ||
          previous.entry_type !== type ||
          previous.reference !== reference
        ) {
          throw new AppError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was used for a different entry',
            409,
          );
        }
        return { id: previous.id };
      }
      return this.entry(
        client,
        userId,
        actorId,
        BigInt(amountPaise),
        balance,
        type,
        reference,
        key,
      );
    });
  }

  async wallet(userId: string, role: string) {
    return this.transaction(async (client) => {
      await this.authorize(client, userId, role);
      const balance = await this.lockWallet(client, userId);
      const entries = await client.query(
        `SELECT id,amount_paise::text,balance_after_paise::text,entry_type,reference,created_at
         FROM provider_wallet_entries WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
        [userId],
      );
      return { balancePaise: balance.toString(), currency: 'INR', entries: entries.rows };
    });
  }

  async requestPayout(userId: string, role: string, amountPaise: number, key: string) {
    if (
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0 ||
      amountPaise > 9999999999 ||
      !key.trim() ||
      key.length > 100
    ) {
      throw new AppError('INVALID_PAYOUT', 'Invalid payout request', 400);
    }
    return this.transaction(async (client) => {
      await this.authorize(client, userId, role);
      // Bank lock precedes wallet lock throughout payout creation. Bank updates
      // wait for this lock and then see the committed pending payout guard.
      const bank = await client.query<{ id: string }>(
        'SELECT id FROM provider_bank_accounts WHERE user_id=$1 AND is_verified=TRUE FOR UPDATE',
        [userId],
      );
      if (!bank.rows[0])
        throw new AppError('BANK_NOT_VERIFIED', 'A verified bank account is required', 409);
      const balance = await this.lockWallet(client, userId);
      const previous = await client.query<{ id: string; amount_paise: string; status: string }>(
        'SELECT id,amount_paise::text,status FROM provider_payouts WHERE user_id=$1 AND idempotency_key=$2',
        [userId, key],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].amount_paise !== String(amountPaise))
          throw new AppError('IDEMPOTENCY_CONFLICT', 'Different payout amount for this key', 409);
        return previous.rows[0];
      }
      if (balance < BigInt(amountPaise))
        throw new AppError('INSUFFICIENT_BALANCE', 'Insufficient wallet balance', 409);
      const payout = await client.query<{ id: string; amount_paise: string; status: string }>(
        `INSERT INTO provider_payouts(user_id,bank_account_id,amount_paise,idempotency_key)
         VALUES($1,$2,$3,$4) RETURNING id,amount_paise::text,status`,
        [userId, bank.rows[0].id, amountPaise, key],
      );
      const row = payout.rows[0]!;
      await this.entry(
        client,
        userId,
        userId,
        -BigInt(amountPaise),
        balance,
        'PAYOUT_RESERVE',
        row.id,
        'payout:' + row.id,
      );
      await this.audit(client, userId, 'payout_requested', row.id, { amountPaise });
      return row;
    });
  }

  async payouts(userId: string, role: string) {
    return this.transaction(async (client) => {
      await this.authorize(client, userId, role);
      return (
        await client.query(
          `SELECT id,amount_paise::text,status,provider_reference,failure_reason,created_at,updated_at
         FROM provider_payouts WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
          [userId],
        )
      ).rows;
    });
  }

  // Operator/payment-adapter handoff; never exposed to a requester route.
  async transitionPayout(
    actorId: string,
    id: string,
    status: 'PROCESSING' | 'SUCCESS' | 'FAILED',
    reference?: string,
    reason?: string,
  ) {
    if (
      !['PROCESSING', 'SUCCESS', 'FAILED'].includes(status) ||
      (status === 'SUCCESS' && !reference?.trim()) ||
      (status === 'FAILED' && !reason?.trim()) ||
      (reference?.length ?? 0) > 150 ||
      (reason?.length ?? 0) > 1000
    ) {
      throw new AppError('INVALID_PAYOUT_STATUS', 'Invalid payout result', 400);
    }
    return this.transaction(async (client) => {
      const actor = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role IN ('admin','super_admin') AND status='active' AND deleted_at IS NULL FOR SHARE",
        [actorId],
      );
      if (!actor.rowCount)
        throw new AppError('FORBIDDEN', 'Payout reviewer is not authorized', 403);
      const result = await client.query<{
        user_id: string;
        amount_paise: string;
        status: string;
        provider_reference: string | null;
        failure_reason: string | null;
      }>(
        'SELECT user_id,amount_paise::text,status,provider_reference,failure_reason FROM provider_payouts WHERE id=$1 FOR UPDATE',
        [id],
      );
      const payout = result.rows[0];
      if (!payout) throw new AppError('PAYOUT_NOT_FOUND', 'Payout not found', 404);
      if (payout.user_id === actorId)
        throw new AppError('SELF_REVIEW_FORBIDDEN', 'Cannot process your own payout', 403);
      if (payout.status === status) {
        if (
          (payout.provider_reference ?? undefined) !== reference ||
          (payout.failure_reason ?? undefined) !== reason
        )
          throw new AppError('IDEMPOTENCY_CONFLICT', 'Payout result differs', 409);
        return;
      }
      if (
        ['SUCCESS', 'FAILED'].includes(payout.status) ||
        (status === 'SUCCESS' && payout.status !== 'PROCESSING')
      ) {
        throw new AppError('INVALID_PAYOUT_TRANSITION', 'Invalid payout transition', 409);
      }
      if (status === 'FAILED') {
        const balance = await this.lockWallet(client, payout.user_id);
        await this.entry(
          client,
          payout.user_id,
          actorId,
          BigInt(payout.amount_paise),
          balance,
          'PAYOUT_REFUND',
          id,
          'refund:' + id,
        );
      }
      await client.query(
        'UPDATE provider_payouts SET status=$2,provider_reference=$3,failure_reason=$4,updated_at=NOW() WHERE id=$1',
        [id, status, reference ?? null, reason ?? null],
      );
      await this.audit(client, actorId, 'payout_status_changed', id, { status, reference });
    });
  }
}
