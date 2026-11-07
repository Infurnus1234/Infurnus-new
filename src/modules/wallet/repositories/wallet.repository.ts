import type { Pool, PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import { withTransaction } from '../../../infrastructure/database/postgres.js';

export interface WalletSummary {
  userId: string;
  balancePaise: number;
  balance: number;
  currency: string;
  isActive: boolean;
  activityCount: number;
}

export interface WalletTransactionEntry {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  amountPaise: number;
  balanceAfter: number;
  balanceAfterPaise: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED';
  paymentMethod: string;
  description: string;
  reference: string;
  createdAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface RecipientDetails {
  targetId: string;
  targetType: 'upi' | 'driver' | 'merchant' | 'order';
  displayName: string;
  isVerified: boolean;
  orderAmount?: number;
  orderAmountPaise?: number;
}

export class PostgresWalletRepository {
  constructor(private readonly pool: Pool) {}

  private async lockUserWallet(client: PoolClient, userId: string): Promise<bigint> {
    await client.query(
      `INSERT INTO user_wallets(user_id, balance_paise, currency, is_active, updated_at)
       VALUES ($1, 0, 'INR', TRUE, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    const result = await client.query<{ balance_paise: string }>(
      `SELECT balance_paise::text FROM user_wallets WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    if (!result.rows[0]) {
      throw new AppError('WALLET_NOT_FOUND', 'User wallet could not be locked', 404);
    }

    return BigInt(result.rows[0].balance_paise);
  }

  async createTopUpOrder(
    userId: string,
    amountPaise: number,
    idempotencyKey: string,
    legacyRequestedPaise?: number,
  ) {
    const result = await this.pool.query<{ orderId: string; amountPaise: string }>(
      `INSERT INTO wallet_topup_orders(order_id,user_id,amount_paise,idempotency_key)
       VALUES ('wallet_' || gen_random_uuid()::text,$1,$2,$3)
       ON CONFLICT(user_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING order_id AS "orderId",amount_paise::text AS "amountPaise"`,
      [userId, amountPaise, idempotencyKey],
    );
    const order = result.rows[0]!;
    if (![amountPaise, legacyRequestedPaise].includes(Number(order.amountPaise)))
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Top-up amount changed for the same request', 409);
    return order;
  }

  async findTopUpOrder(userId: string, orderId: string) {
    const result = await this.pool.query<{ orderId: string; amountPaise: string }>(
      `SELECT order_id AS "orderId",amount_paise::text AS "amountPaise" FROM wallet_topup_orders WHERE order_id=$1 AND user_id=$2`,
      [orderId, userId],
    );
    return result.rows[0];
  }

  async getWallet(userId: string): Promise<WalletSummary> {
    await this.pool.query(
      `INSERT INTO user_wallets(user_id, balance_paise, currency, is_active, updated_at)
       VALUES ($1, 0, 'INR', TRUE, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    const walletResult = await this.pool.query<{
      balance_paise: string;
      currency: string;
      is_active: boolean;
    }>(`SELECT balance_paise::text, currency, is_active FROM user_wallets WHERE user_id = $1`, [
      userId,
    ]);

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM user_wallet_entries WHERE user_id = $1`,
      [userId],
    );

    const row = walletResult.rows[0];
    const balancePaise = row ? Number(row.balance_paise) : 0;
    const activityCount = countResult.rows[0] ? Number(countResult.rows[0].count) : 0;

    return {
      userId,
      balancePaise,
      balance: balancePaise / 100.0,
      currency: row?.currency ?? 'INR',
      isActive: row?.is_active ?? true,
      activityCount,
    };
  }

  async getHistory(
    userId: string,
    filter?: { type?: 'all' | 'credit' | 'debit'; limit?: number; offset?: number },
  ): Promise<{
    transactions: WalletTransactionEntry[];
    totalCount: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.max(1, Math.min(filter?.limit ?? 20, 100));
    const offset = Math.max(0, filter?.offset ?? 0);
    const filterType = filter?.type ?? 'all';

    let condition = 'WHERE user_id = $1';
    const params: unknown[] = [userId];

    if (filterType === 'credit') {
      condition += ' AND amount_paise > 0';
    } else if (filterType === 'debit') {
      condition += ' AND amount_paise < 0';
    }

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM user_wallet_entries ${condition}`,
      params,
    );
    const totalCount = Number(countResult.rows[0]?.count ?? '0');

    const query = `
      SELECT
        id,
        amount_paise::text as amount_paise,
        balance_after_paise::text as balance_after_paise,
        entry_type,
        reference,
        description,
        payment_method,
        status,
        metadata,
        created_at
      FROM user_wallet_entries
      ${condition}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await this.pool.query<{
      id: string;
      amount_paise: string;
      balance_after_paise: string;
      entry_type: string;
      reference: string;
      description: string | null;
      payment_method: string | null;
      status: string;
      metadata: Record<string, unknown> | null;
      created_at: Date;
    }>(query, [...params, limit, offset]);

    const transactions: WalletTransactionEntry[] = result.rows.map((row) => {
      const rawPaise = Number(row.amount_paise);
      const absPaise = Math.abs(rawPaise);
      const isCredit = rawPaise > 0;
      const balanceAfterPaise = Number(row.balance_after_paise);

      return {
        id: row.id,
        type: isCredit ? 'credit' : 'debit',
        amount: absPaise / 100.0,
        amountPaise: absPaise,
        balanceAfter: balanceAfterPaise / 100.0,
        balanceAfterPaise,
        status: (row.status?.toUpperCase() as WalletTransactionEntry['status']) || 'COMPLETED',
        paymentMethod: row.payment_method || (isCredit ? 'UPI / GATEWAY' : 'WALLET'),
        description: row.description || (isCredit ? 'Wallet Top-Up' : 'Payment Debit'),
        reference: row.reference,
        createdAt: row.created_at.toISOString(),
        metadata: row.metadata || undefined,
      };
    });

    return { transactions, totalCount, limit, offset };
  }

  async topUp(
    userId: string,
    amountPaise: number,
    paymentMethod: string,
    reference: string,
    idempotencyKey: string,
    description?: string,
  ): Promise<{ wallet: WalletSummary; entry: WalletTransactionEntry }> {
    if (amountPaise <= 0) {
      throw new AppError('INVALID_AMOUNT', 'Top-up amount must be greater than zero', 400);
    }

    return withTransaction(async (client) => {
      const currentBalance = await this.lockUserWallet(client, userId);
      // 1. Idempotency Check
      const existing = await client.query<{
        id: string;
        amount_paise: string;
        balance_after_paise: string;
        status: string;
        reference: string;
        description: string | null;
        payment_method: string | null;
        created_at: Date;
      }>(
        `SELECT id, amount_paise::text, balance_after_paise::text, status, reference, description, payment_method, created_at
         FROM user_wallet_entries
         WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey],
      );

      if (existing.rows[0]) {
        const e = existing.rows[0];
        const w: WalletSummary = {
          userId,
          balancePaise: Number(currentBalance),
          balance: Number(currentBalance) / 100,
          currency: 'INR',
          isActive: true,
          activityCount: 0,
        };
        return {
          wallet: w,
          entry: {
            id: e.id,
            type: 'credit',
            amount: Number(e.amount_paise) / 100.0,
            amountPaise: Number(e.amount_paise),
            balanceAfter: Number(e.balance_after_paise) / 100.0,
            balanceAfterPaise: Number(e.balance_after_paise),
            status: e.status as WalletTransactionEntry['status'],
            paymentMethod: e.payment_method || paymentMethod,
            description: e.description || 'Wallet Top-Up',
            reference: e.reference,
            createdAt: e.created_at.toISOString(),
          },
        };
      }

      // 2. Lock and Update
      const nextBalance = currentBalance + BigInt(amountPaise);

      await client.query(
        `UPDATE user_wallets
         SET balance_paise = $2, updated_at = NOW()
         WHERE user_id = $1`,
        [userId, nextBalance.toString()],
      );

      const entryResult = await client.query<{
        id: string;
        created_at: Date;
      }>(
        `INSERT INTO user_wallet_entries(
           user_id, amount_paise, balance_after_paise, entry_type,
           reference, description, payment_method, status, idempotency_key
         ) VALUES ($1, $2, $3, 'TOPUP', $4, $5, $6, 'COMPLETED', $7)
         RETURNING id, created_at`,
        [
          userId,
          amountPaise.toString(),
          nextBalance.toString(),
          reference,
          description || 'Wallet Top-Up',
          paymentMethod,
          idempotencyKey,
        ],
      );

      const created = entryResult.rows[0]!;
      const totalPaise = Number(nextBalance);

      return {
        wallet: {
          userId,
          balancePaise: totalPaise,
          balance: totalPaise / 100.0,
          currency: 'INR',
          isActive: true,
          activityCount: 0,
        },
        entry: {
          id: created.id,
          type: 'credit',
          amount: amountPaise / 100.0,
          amountPaise,
          balanceAfter: totalPaise / 100.0,
          balanceAfterPaise: totalPaise,
          status: 'COMPLETED',
          paymentMethod,
          description: description || 'Wallet Top-Up',
          reference,
          createdAt: created.created_at.toISOString(),
        },
      };
    });
  }

  async pay(
    senderId: string,
    amountPaise: number,
    target: { type: string; id: string; name?: string | undefined; orderId?: string | undefined },
    idempotencyKey: string,
    note?: string | undefined,
  ): Promise<{
    transactionId: string;
    status: string;
    balanceAfter: number;
    balanceAfterPaise: number;
    reference: string;
  }> {
    if (amountPaise <= 0) {
      throw new AppError('INVALID_AMOUNT', 'Payment amount must be greater than zero', 400);
    }

    // Wallet-to-wallet transfers require an existing recipient. External UPI
    // settlement must use a configured payout provider, never just a local debit.
    if (target.type === 'order')
      throw new AppError(
        'BOOKING_CHECKOUT_REQUIRED',
        'Pay this booking through its booking checkout',
        409,
      );
    if (
      !['driver', 'merchant'].includes(target.type) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.id)
    )
      throw new AppError(
        'EXTERNAL_TRANSFER_UNAVAILABLE',
        'External wallet transfers are not configured',
        503,
      );
    const recipient = (
      await this.pool.query<{ id: string }>(
        `SELECT u.id FROM users u LEFT JOIN driver_profiles dp ON dp.user_id=u.id
       WHERE (u.id=$1 OR ($2='driver' AND dp.id=$1)) AND u.status='active' LIMIT 1`,
        [target.id, target.type],
      )
    ).rows[0];
    if (!recipient) throw new AppError('RECIPIENT_NOT_FOUND', 'Recipient account not found', 404);
    if (recipient.id === senderId)
      throw new AppError('INVALID_RECIPIENT', 'Choose a different recipient', 400);
    return withTransaction(async (client) => {
      // Stable lock order prevents opposite-direction transfers from deadlocking.
      const balances = new Map<string, bigint>();
      for (const id of [senderId, recipient.id].sort())
        balances.set(id, await this.lockUserWallet(client, id));
      const existing = (
        await client.query<{
          id: string;
          balance_after_paise: string;
          reference: string;
          status: string;
        }>(
          `SELECT id,balance_after_paise::text,reference,status FROM user_wallet_entries WHERE user_id=$1 AND idempotency_key=$2`,
          [senderId, idempotencyKey],
        )
      ).rows[0];
      if (existing)
        return {
          transactionId: existing.id,
          status: existing.status,
          balanceAfter: Number(existing.balance_after_paise) / 100,
          balanceAfterPaise: Number(existing.balance_after_paise),
          reference: existing.reference,
        };
      const current = balances.get(senderId)!;
      if (current < BigInt(amountPaise))
        throw new AppError('INSUFFICIENT_BALANCE', 'Insufficient wallet balance', 400);
      const next = current - BigInt(amountPaise);
      const recipientNext = balances.get(recipient.id)! + BigInt(amountPaise);
      await client.query(
        'UPDATE user_wallets SET balance_paise=$2,updated_at=NOW() WHERE user_id=$1',
        [senderId, next.toString()],
      );
      await client.query(
        'UPDATE user_wallets SET balance_paise=$2,updated_at=NOW() WHERE user_id=$1',
        [recipient.id, recipientNext.toString()],
      );
      const entry = (
        await client.query<{ id: string }>(
          `INSERT INTO user_wallet_entries(user_id,amount_paise,balance_after_paise,entry_type,reference,description,payment_method,status,idempotency_key,metadata)
         VALUES ($1,$2,$3,'DEBIT_PAYMENT',$4,$5,'WALLET','COMPLETED',$6,$7) RETURNING id`,
          [
            senderId,
            (-amountPaise).toString(),
            next.toString(),
            idempotencyKey,
            note || 'Wallet transfer',
            idempotencyKey,
            JSON.stringify({ recipientId: recipient.id }),
          ],
        )
      ).rows[0]!;
      await client.query(
        `INSERT INTO user_wallet_entries(user_id,amount_paise,balance_after_paise,entry_type,reference,description,payment_method,status,idempotency_key,metadata)
         VALUES ($1,$2,$3,'PEER_TRANSFER',$4,'Wallet transfer received','WALLET','COMPLETED',$5,$6)`,
        [
          recipient.id,
          amountPaise.toString(),
          recipientNext.toString(),
          entry.id,
          'credit:' + entry.id,
          JSON.stringify({ senderId }),
        ],
      );
      return {
        transactionId: entry.id,
        status: 'COMPLETED',
        balanceAfter: Number(next) / 100,
        balanceAfterPaise: Number(next),
        reference: idempotencyKey,
      };
    });
  }

  async resolveRecipient(targetType: string, targetId: string): Promise<RecipientDetails> {
    const cleanId = targetId.trim();

    // 1. UPI ID resolution
    if (targetType === 'upi' || cleanId.includes('@')) {
      const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
      if (!upiRegex.test(cleanId)) {
        throw new AppError('INVALID_UPI_ID', 'Invalid UPI ID format. E.g. name@bank', 400);
      }
      return {
        targetId: cleanId,
        targetType: 'upi',
        displayName: cleanId.split('@')[0]?.toUpperCase() ?? cleanId,
        isVerified: true,
      };
    }

    // 2. Driver resolution
    if (targetType === 'driver') {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        cleanId,
      );
      if (isUuid) {
        const driverRes = await this.pool.query<{ name: string }>(
          `SELECT concat_ws(' ',u.first_name,u.last_name) AS name
           FROM users u
           JOIN driver_profiles dp ON dp.user_id = u.id
           WHERE dp.id = $1 OR u.id = $1
           LIMIT 1`,
          [cleanId],
        );
        if (driverRes.rows[0]) {
          return {
            targetId: cleanId,
            targetType: 'driver',
            displayName: driverRes.rows[0].name,
            isVerified: true,
          };
        }
      }
      return {
        targetId: cleanId,
        targetType: 'driver',
        displayName: 'Unknown driver',
        isVerified: false,
      };
    }

    // 3. Logistics Order resolution
    if (targetType === 'order') {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        cleanId,
      );
      if (isUuid) {
        const orderRes = await this.pool.query<{
          id: string;
          status: string;
          final_fare: string | null;
          fare_estimate: string | null;
        }>(
          `SELECT id, status, final_fare::text, fare_estimate::text FROM rides WHERE id = $1 LIMIT 1`,
          [cleanId],
        );
        if (orderRes.rows[0]) {
          const ord = orderRes.rows[0];
          const fare = Number(ord.final_fare ?? ord.fare_estimate ?? '0');
          return {
            targetId: cleanId,
            targetType: 'order',
            displayName: `Logistics Order #${cleanId.substring(0, 8)}`,
            isVerified: true,
            orderAmount: fare,
            orderAmountPaise: Math.round(fare * 100),
          };
        }
      }
      return {
        targetId: cleanId,
        targetType: 'order',
        displayName: `Order #${cleanId.substring(0, 8)}`,
        isVerified: false,
      };
    }

    // 4. Default Merchant Code
    return {
      targetId: cleanId,
      targetType: 'merchant',
      displayName: `Merchant: ${cleanId.toUpperCase()}`,
      isVerified: false,
    };
  }
}
