import type { Pool, PoolClient } from 'pg';
import type { CreateRentalInput, ListRentalsInput } from '../schemas/rental.schemas.js';
import type { Rental, RentalStatus } from '../types/rental.js';

export interface RentalRepository {
  create(
    userId: string,
    input: CreateRentalInput,
    idempotencyKey: string,
    client?: PoolClient,
  ): Promise<{ rental: Rental; created: boolean }>;

  findByIdForUser(id: string, userId: string): Promise<Rental | null>;

  listForUser(userId: string, query: ListRentalsInput): Promise<Rental[]>;

  cancel(id: string, userId: string, reason: string, client?: PoolClient): Promise<Rental | null>;

  transition(
    id: string,
    fromStatus: RentalStatus,
    toStatus: RentalStatus,
    client?: PoolClient,
  ): Promise<Rental | null>;

  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Rental | null>;
}

const projection = `
  id,
  user_id AS "userId",
  vehicle_id AS "vehicleId",
  start_at AS "startAt",
  end_at AS "endAt",
  status,
  total_amount AS "totalAmount",
  currency,
  cancellation_reason AS "cancellationReason",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  completed_at AS "completedAt",
  cancelled_at AS "cancelledAt"
`;

function mapRental(row: Record<string, unknown>): Rental {
  return {
    id: row.id as string,
    userId: row.userId as string,
    vehicleId: row.vehicleId as string,
    startAt: row.startAt as Date,
    endAt: row.endAt as Date,
    status: row.status as RentalStatus,
    totalAmount: Number(row.totalAmount),
    currency: row.currency as string,
    cancellationReason: row.cancellationReason as string | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    completedAt: row.completedAt as Date | null,
    cancelledAt: row.cancelledAt as Date | null,
  };
}

export class PostgresRentalRepository implements RentalRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    userId: string,
    input: CreateRentalInput,
    idempotencyKey: string,
    client: PoolClient | Pool = this.pool,
  ): Promise<{ rental: Rental; created: boolean }> {
    const inserted = await client.query(
      `INSERT INTO rentals
        (user_id, vehicle_id, start_at, end_at, total_amount, currency, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING ${projection}`,
      [
        userId,
        input.vehicleId,
        input.startAt,
        input.endAt,
        input.totalAmount,
        input.currency,
        idempotencyKey,
      ],
    );

    if (inserted.rows[0]) {
      return {
        rental: mapRental(inserted.rows[0]),
        created: true,
      };
    }

    const existing = await this.findByIdempotencyKeyWithClient(userId, idempotencyKey, client);

    if (!existing) {
      throw new Error('Idempotent rental lookup returned no row');
    }

    return {
      rental: existing,
      created: false,
    };
  }

  async findByIdForUser(id: string, userId: string): Promise<Rental | null> {
    const result = await this.pool.query(
      `SELECT ${projection}
       FROM rentals
       WHERE id = $1
         AND user_id = $2`,
      [id, userId],
    );

    return result.rows[0] ? mapRental(result.rows[0]) : null;
  }

  async listForUser(userId: string, query: ListRentalsInput): Promise<Rental[]> {
    const result = await this.pool.query(
      `SELECT ${projection}
       FROM rentals
       WHERE user_id = $1
         AND ($2::rental_status IS NULL OR status = $2)
         AND ($3::uuid IS NULL OR vehicle_id = $3)
         AND ($4::timestamptz IS NULL OR created_at < $4)
       ORDER BY created_at DESC, id DESC
       LIMIT $5`,
      [userId, query.status ?? null, query.vehicleId ?? null, query.cursor ?? null, query.limit],
    );

    return result.rows.map(mapRental);
  }

  async cancel(
    id: string,
    userId: string,
    reason: string,
    client: PoolClient | Pool = this.pool,
  ): Promise<Rental | null> {
    const result = await client.query(
      `UPDATE rentals
       SET status = 'CANCELLED',
           cancellation_reason = $3,
           cancelled_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND status IN ('PENDING', 'CONFIRMED')
       RETURNING ${projection}`,
      [id, userId, reason],
    );

    return result.rows[0] ? mapRental(result.rows[0]) : null;
  }

  async transition(
    id: string,
    fromStatus: RentalStatus,
    toStatus: RentalStatus,
    client: PoolClient | Pool = this.pool,
  ): Promise<Rental | null> {
    const result = await client.query(
      `UPDATE rentals
       SET status = $2::rental_status,
           completed_at = CASE
             WHEN $2::rental_status = 'COMPLETED' THEN NOW()
             ELSE completed_at
           END
       WHERE id = $1
       RETURNING ${projection}`,
      [id, fromStatus, toStatus],
    );

    return result.rows[0] ? mapRental(result.rows[0]) : null;
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Rental | null> {
    return this.findByIdempotencyKeyWithClient(userId, idempotencyKey, this.pool);
  }

  private async findByIdempotencyKeyWithClient(
    userId: string,
    idempotencyKey: string,
    client: PoolClient | Pool,
  ): Promise<Rental | null> {
    const result = await client.query(
      `SELECT ${projection}
       FROM rentals
       WHERE user_id = $1
         AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );

    return result.rows[0] ? mapRental(result.rows[0]) : null;
  }
}
