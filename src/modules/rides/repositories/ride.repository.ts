import type { Pool, PoolClient } from 'pg';
import { env } from '../../../config/env.js';
import type { CreateRideInput, ListRidesInput } from '../schemas/ride.schemas.js';
import type { Ride } from '../types/ride.js';

export interface RideRepository {
  create(customerId: string, input: CreateRideInput): Promise<Ride>;
  findByIdForCustomer(id: string, customerId: string): Promise<Ride | null>;
  listForCustomer(customerId: string, query: ListRidesInput): Promise<Ride[]>;
  cancel(id: string, customerId: string, reason: string, client?: PoolClient): Promise<Ride | null>;
  accept(id: string, driverProfileId: string, client?: PoolClient): Promise<Ride | null>;
  transition(
    id: string,
    status: Ride['status'],
    assignedDriverId?: string,
    client?: PoolClient,
  ): Promise<Ride | null>;
  isParticipant(id: string, userId: string): Promise<boolean>;
  isAssignedDriver(id: string, userId: string): Promise<boolean>;
}

const projection = `
  id, customer_id AS "customerId", assigned_driver_id AS "assignedDriverId",
  assigned_vehicle_id AS "assignedVehicleId", ST_Y(pickup_location::geometry) AS "pickupLatitude",
  ST_X(pickup_location::geometry) AS "pickupLongitude",
  ST_Y(destination_location::geometry) AS "destinationLatitude",
  ST_X(destination_location::geometry) AS "destinationLongitude",
  pickup_address AS "pickupAddress", destination_address AS "destinationAddress", status,
  cancellation_reason AS "cancellationReason", cancelled_at AS "cancelledAt",
  completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

function mapRide(row: Record<string, unknown>): Ride {
  return {
    id: row.id as string,
    customerId: row.customerId as string,
    assignedDriverId: row.assignedDriverId as string | null,
    assignedVehicleId: row.assignedVehicleId as string | null,
    pickup: { latitude: row.pickupLatitude as number, longitude: row.pickupLongitude as number },
    destination: {
      latitude: row.destinationLatitude as number,
      longitude: row.destinationLongitude as number,
    },
    pickupAddress: row.pickupAddress as string | null,
    destinationAddress: row.destinationAddress as string | null,
    status: row.status as Ride['status'],
    cancellationReason: row.cancellationReason as string | null,
    cancelledAt: row.cancelledAt as Date | null,
    completedAt: row.completedAt as Date | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export class PostgresRideRepository implements RideRepository {
  constructor(private readonly pool: Pool) {}

  async create(customerId: string, input: CreateRideInput): Promise<Ride> {
    const result = await this.pool.query(
      `INSERT INTO rides
       (customer_id, pickup_location, destination_location, pickup_address, destination_address)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
          ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7)
       RETURNING ${projection}`,
      [
        customerId,
        input.pickup.longitude,
        input.pickup.latitude,
        input.destination.longitude,
        input.destination.latitude,
        input.pickupAddress ?? null,
        input.destinationAddress ?? null,
      ],
    );
    return mapRide(result.rows[0]);
  }

  async findByIdForCustomer(id: string, customerId: string): Promise<Ride | null> {
    const result = await this.pool.query(
      `SELECT ${projection} FROM rides WHERE id = $1 AND customer_id = $2`,
      [id, customerId],
    );
    return result.rows[0] ? mapRide(result.rows[0]) : null;
  }

  async listForCustomer(customerId: string, query: ListRidesInput): Promise<Ride[]> {
    const result = await this.pool.query(
      `SELECT ${projection} FROM rides
       WHERE customer_id = $1 AND ($2::ride_status IS NULL OR status = $2)
         AND ($3::timestamptz IS NULL OR created_at < $3)
       ORDER BY created_at DESC, id DESC LIMIT $4`,
      [customerId, query.status ?? null, query.cursor ?? null, query.limit],
    );
    return result.rows.map(mapRide);
  }

  async cancel(
    id: string,
    customerId: string,
    reason: string,
    client: PoolClient | Pool = this.pool,
  ): Promise<Ride | null> {
    const result = await client.query(
      `UPDATE rides SET status = 'cancelled', cancellation_reason = $3, cancelled_at = NOW()
       WHERE id = $1 AND customer_id = $2
         AND status IN ('requested', 'searching', 'driver_assigned', 'driver_arriving', 'driver_arrived')
       RETURNING ${projection}`,
      [id, customerId, reason],
    );
    return result.rows[0] ? mapRide(result.rows[0]) : null;
  }

  async accept(id: string, driverProfileId: string, client: PoolClient | Pool = this.pool) {
    const result = await client.query(
      `UPDATE rides r
       SET assigned_driver_id = $2,
           assigned_vehicle_id = (
             SELECT v.id FROM vehicles v
             WHERE v.driver_profile_id = $2 AND v.is_active = TRUE
             ORDER BY v.id LIMIT 1
           ),
           status = 'driver_assigned'
       WHERE r.id = $1 AND r.status = 'searching'
         AND EXISTS (
           SELECT 1 FROM driver_profiles dp
           JOIN users u ON u.id = dp.user_id
           WHERE dp.id = $2 AND u.status = 'active'
             AND dp.verification_status = 'approved'
             AND dp.availability_status = 'available'
             AND dp.last_location_at >= NOW() - ($3::int * INTERVAL '1 second')
         )
         AND EXISTS (
           SELECT 1 FROM vehicles v
           WHERE v.driver_profile_id = $2 AND v.is_active = TRUE
         )
       RETURNING ${projection}`,
      [id, driverProfileId, env.DRIVER_LOCATION_STALE_SECONDS],
    );
    return result.rows[0] ? mapRide(result.rows[0]) : null;
  }

  async transition(
    id: string,
    status: Ride['status'],
    assignedDriverId?: string,
    client: PoolClient | Pool = this.pool,
  ) {
    const result = await client.query(
      `UPDATE rides SET status = $2::ride_status
       WHERE id = $1 AND ($3::uuid IS NULL OR assigned_driver_id = $3)
       RETURNING ${projection}`,
      [id, status, assignedDriverId ?? null],
    );
    return result.rows[0] ? mapRide(result.rows[0]) : null;
  }

  async isParticipant(id: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM rides r
       LEFT JOIN driver_profiles dp ON dp.id = r.assigned_driver_id
       WHERE r.id = $1 AND (r.customer_id = $2 OR dp.user_id = $2)`,
      [id, userId],
    );
    return result.rowCount === 1;
  }

  async isAssignedDriver(id: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM rides r
       JOIN driver_profiles dp ON dp.id = r.assigned_driver_id
       WHERE r.id = $1 AND dp.user_id = $2`,
      [id, userId],
    );
    return result.rowCount === 1;
  }
}
