import { randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { env } from '../../../config/env.js';
import type { CreateRideInput, ListRidesInput } from '../schemas/ride.schemas.js';
import type { Ride } from '../types/ride.js';

export interface RouteMetadata {
  lastCalculatedAt: number | null;
  lastOrigin: {
    latitude: number;
    longitude: number;
  } | null;
  route: {
    distanceMeters: number;
    durationSeconds: number;
    encodedPolyline?: string;
  } | null;
  pin?: string;
  pinVerified?: boolean;
  pinVerifiedAt?: string;
}

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
  complete(id: string, assignedDriverId: string, client: PoolClient): Promise<Ride | null>;
  isParticipant(id: string, userId: string): Promise<boolean>;
  isAssignedDriver(id: string, userId: string): Promise<boolean>;
  isAssignedDriverProfile(id: string, driverProfileId: string): Promise<boolean>;
  getRouteMetadata(id: string): Promise<RouteMetadata | null>;
  getDestination(id: string): Promise<{
    latitude: number;
    longitude: number;
  } | null>;
  updateRouteMetadata(id: string, metadata: RouteMetadata): Promise<boolean>;
  getRidePin(id: string): Promise<string | null>;
  markPinVerified(id: string): Promise<boolean>;
  isPinVerified(id: string): Promise<boolean>;
  listAvailable(limit?: number): Promise<Ride[]>;
  listForDriver(driverProfileId: string, limit?: number): Promise<Ride[]>;
}

const detailedRideColumns = (tableAlias = 'r') => `
  ${tableAlias}.id,
  ${tableAlias}.customer_id AS "customerId",
  ${tableAlias}.assigned_driver_id AS "assignedDriverId",
  ${tableAlias}.assigned_vehicle_id AS "assignedVehicleId",
  ST_Y(${tableAlias}.pickup_location::geometry) AS "pickupLatitude",
  ST_X(${tableAlias}.pickup_location::geometry) AS "pickupLongitude",
  ST_Y(${tableAlias}.destination_location::geometry) AS "destinationLatitude",
  ST_X(${tableAlias}.destination_location::geometry) AS "destinationLongitude",
  ${tableAlias}.pickup_address AS "pickupAddress",
  ${tableAlias}.destination_address AS "destinationAddress",
  ${tableAlias}.status,
  (${tableAlias}.route_metadata->>'fareEstimate')::numeric AS "fareEstimate",
  ${tableAlias}.route_metadata->>'sector' AS "sector",
  ${tableAlias}.route_metadata->>'vehicleCategory' AS "vehicleCategory",
  ${tableAlias}.route_metadata->'goods' AS "goods",
  ${tableAlias}.route_metadata->'serviceDetails' AS "serviceDetails",
  ${tableAlias}.route_metadata->'rentalDetails' AS "rentalDetails",
  ${tableAlias}.route_metadata->>'pin' AS "pin",
  CASE
    WHEN ${tableAlias}.assigned_driver_id IS NOT NULL THEN
      NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '')
    ELSE NULL
  END AS "driverName",
  u.phone AS "driverPhone",
  u.profile_photo_key AS "driverPhotoUrl",
  (
    SELECT ROUND(AVG(rat.rating)::numeric, 1)
    FROM ratings rat
    WHERE rat.driver_profile_id = ${tableAlias}.assigned_driver_id
  ) AS "driverRating",
  v.make AS "vehicleMake",
  v.model AS "vehicleModel",
  v.color AS "vehicleColor",
  v.plate_number AS "vehiclePlateNumber",
  ${tableAlias}.cancellation_reason AS "cancellationReason",
  ${tableAlias}.cancelled_at AS "cancelledAt",
  ${tableAlias}.completed_at AS "completedAt",
  ${tableAlias}.created_at AS "createdAt",
  ${tableAlias}.updated_at AS "updatedAt"`;

const detailedRideJoins = (tableAlias = 'r') => `
  LEFT JOIN driver_profiles dp ON dp.id = ${tableAlias}.assigned_driver_id
  LEFT JOIN users u ON u.id = dp.user_id
  LEFT JOIN vehicles v ON v.id = ${tableAlias}.assigned_vehicle_id`;

function mapRide(row: Record<string, unknown>, forCustomer = false): Ride {
  return {
    id: row.id as string,
    customerId: row.customerId as string,
    assignedDriverId: (row.assignedDriverId as string) || null,
    assignedVehicleId: (row.assignedVehicleId as string) || null,
    pickup: {
      latitude: Number(row.pickupLatitude),
      longitude: Number(row.pickupLongitude),
    },
    destination: {
      latitude: Number(row.destinationLatitude),
      longitude: Number(row.destinationLongitude),
    },
    pickupAddress: (row.pickupAddress as string) || null,
    destinationAddress: (row.destinationAddress as string) || null,
    status: row.status as Ride['status'],
    fareEstimate: row.fareEstimate != null ? Number(row.fareEstimate) : null,
    sector: (row.sector as string | null) ?? 'passenger',
    vehicleCategory: (row.vehicleCategory as string | null) ?? null,
    goods: (row.goods as Record<string, unknown> | null) ?? null,
    serviceDetails: (row.serviceDetails as Record<string, unknown> | null) ?? null,
    rentalDetails: (row.rentalDetails as Record<string, unknown> | null) ?? null,
    pin: forCustomer && row.pin != null ? String(row.pin) : null,
    driverDetails:
      row.assignedDriverId && row.driverName
        ? {
            id: row.assignedDriverId as string,
            name: row.driverName as string,
            phone: (row.driverPhone as string | null) ?? null,
            rating: row.driverRating != null ? Number(row.driverRating) : null,
            photoUrl: (row.driverPhotoUrl as string | null) ?? null,
          }
        : null,
    vehicleDetails:
      row.assignedVehicleId && row.vehicleMake && row.vehiclePlateNumber
        ? {
            make: row.vehicleMake as string,
            model: (row.vehicleModel as string) ?? '',
            color: (row.vehicleColor as string | null) ?? null,
            plateNumber: row.vehiclePlateNumber as string,
          }
        : null,
    cancellationReason: (row.cancellationReason as string) || null,
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt as string | number | Date) : null,
    completedAt: row.completedAt ? new Date(row.completedAt as string | number | Date) : null,
    createdAt: new Date(row.createdAt as string | number | Date),
    updatedAt: new Date(row.updatedAt as string | number | Date),
  };
}

export class PostgresRideRepository implements RideRepository {
  constructor(private readonly pool: Pool) {}

  async create(customerId: string, input: CreateRideInput): Promise<Ride> {
    const pin = randomInt(1000, 10000).toString();
    const result = await this.pool.query(
      `WITH inserted AS (
         INSERT INTO rides
         (customer_id, pickup_location, destination_location, pickup_address, destination_address, status, route_metadata)
         VALUES (
           $1,
           ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
           ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
           $6,
           $7,
           'searching',
           jsonb_build_object(
             'fareEstimate', $8::numeric,
             'sector', $9::text,
             'vehicleCategory', $10::text,
             'goods', $11::jsonb,
             'serviceDetails', $12::jsonb,
             'rentalDetails', $13::jsonb,
             'pin', $14::text,
             'lastCalculatedAt', null,
             'lastOrigin', null,
             'route', null
           )
         )
         RETURNING *
       )
       SELECT ${detailedRideColumns('ins')}
       FROM inserted ins
       ${detailedRideJoins('ins')}`,
      [
        customerId,
        input.pickup.longitude,
        input.pickup.latitude,
        input.destination.longitude,
        input.destination.latitude,
        input.pickupAddress ?? null,
        input.destinationAddress ?? null,
        input.fareEstimate ?? null,
        input.sector ?? 'passenger',
        input.vehicleCategory ?? null,
        input.goods ? JSON.stringify(input.goods) : null,
        input.serviceDetails ? JSON.stringify(input.serviceDetails) : null,
        input.rentalDetails ? JSON.stringify(input.rentalDetails) : null,
        pin,
      ],
    );

    return mapRide(result.rows[0], true);
  }

  async findByIdForCustomer(id: string, customerId: string): Promise<Ride | null> {
    const result = await this.pool.query(
      `SELECT ${detailedRideColumns('r')}
       FROM rides r
       ${detailedRideJoins('r')}
       WHERE r.id = $1
         AND r.customer_id = $2`,
      [id, customerId],
    );

    return result.rows[0] ? mapRide(result.rows[0], true) : null;
  }

  async listForCustomer(customerId: string, query: ListRidesInput): Promise<Ride[]> {
    const result = await this.pool.query(
      `SELECT ${detailedRideColumns('r')}
       FROM rides r
       ${detailedRideJoins('r')}
       WHERE r.customer_id = $1
         AND ($2::ride_status IS NULL OR r.status = $2)
         AND ($3::timestamptz IS NULL OR r.created_at < $3)
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $4`,
      [customerId, query.status ?? null, query.cursor ?? null, query.limit],
    );

    return result.rows.map((row) => mapRide(row, true));
  }

  async cancel(
    id: string,
    customerId: string,
    reason: string,
    client: PoolClient | Pool = this.pool,
  ): Promise<Ride | null> {
    const result = await client.query(
      `WITH updated AS (
         UPDATE rides
         SET status = 'cancelled',
             cancellation_reason = $3,
             cancelled_at = NOW()
         WHERE id = $1
           AND customer_id = $2
           AND status IN (
             'requested',
             'searching',
             'driver_assigned',
             'driver_arriving',
             'driver_arrived'
           )
         RETURNING *
       )
       SELECT ${detailedRideColumns('u_r')}
       FROM updated u_r
       ${detailedRideJoins('u_r')}`,
      [id, customerId, reason],
    );

    return result.rows[0] ? mapRide(result.rows[0], true) : null;
  }

  async accept(
    id: string,
    driverProfileId: string,
    client: PoolClient | Pool = this.pool,
  ): Promise<Ride | null> {
    const result = await client.query(
      `WITH updated AS (
         UPDATE rides r
         SET assigned_driver_id = $2,
             assigned_vehicle_id = (
               SELECT v.id
               FROM vehicles v
               WHERE v.driver_profile_id = $2
                 AND v.is_active = TRUE
               ORDER BY v.id
               LIMIT 1
             ),
             status = 'driver_assigned'
         WHERE r.id = $1
           AND r.status = 'searching'
           AND EXISTS (
             SELECT 1
             FROM driver_profiles dp
             JOIN users u ON u.id = dp.user_id
             WHERE dp.id = $2
               AND u.status = 'active'
               AND dp.verification_status = 'approved'
               AND dp.availability_status = 'available'
               AND dp.last_location_at >= NOW() -
                 ($3::int * INTERVAL '1 second')
           )
           AND EXISTS (
             SELECT 1
             FROM vehicles v
             WHERE v.driver_profile_id = $2
               AND v.is_active = TRUE
           )
         RETURNING *
       )
       SELECT ${detailedRideColumns('u_r')}
       FROM updated u_r
       ${detailedRideJoins('u_r')}`,
      [id, driverProfileId, env.DRIVER_LOCATION_STALE_SECONDS],
    );

    return result.rows[0] ? mapRide(result.rows[0], false) : null;
  }

  async transition(
    id: string,
    status: Ride['status'],
    assignedDriverId?: string,
    client: PoolClient | Pool = this.pool,
  ): Promise<Ride | null> {
    const result = await client.query(
      `WITH updated AS (
         UPDATE rides
         SET status = $2::ride_status
         WHERE id = $1
           AND ($3::uuid IS NULL OR assigned_driver_id = $3)
         RETURNING *
       )
       SELECT ${detailedRideColumns('u_r')}
       FROM updated u_r
       ${detailedRideJoins('u_r')}`,
      [id, status, assignedDriverId ?? null],
    );

    return result.rows[0] ? mapRide(result.rows[0], false) : null;
  }

  async complete(id: string, assignedDriverId: string, client: PoolClient): Promise<Ride | null> {
    const result = await client.query(
      `WITH updated AS (
         UPDATE rides
         SET status = 'completed',
             completed_at = NOW()
         WHERE id = $1
           AND assigned_driver_id = $2
           AND status = 'in_progress'
         RETURNING *
       )
       SELECT ${detailedRideColumns('u_r')}
       FROM updated u_r
       ${detailedRideJoins('u_r')}`,
      [id, assignedDriverId],
    );

    return result.rows[0] ? mapRide(result.rows[0], false) : null;
  }

  async isParticipant(id: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM rides r
       LEFT JOIN driver_profiles dp
         ON dp.id = r.assigned_driver_id
       WHERE r.id = $1
         AND (r.customer_id = $2 OR dp.user_id = $2)`,
      [id, userId],
    );

    return result.rowCount === 1;
  }

  async isAssignedDriver(id: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM rides r
       JOIN driver_profiles dp
         ON dp.id = r.assigned_driver_id
       WHERE r.id = $1
         AND dp.user_id = $2`,
      [id, userId],
    );

    return result.rowCount === 1;
  }

  async isAssignedDriverProfile(id: string, driverProfileId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM rides
       WHERE id = $1
         AND assigned_driver_id = $2`,
      [id, driverProfileId],
    );

    return (result.rowCount ?? 0) === 1;
  }

  async getRouteMetadata(id: string): Promise<RouteMetadata | null> {
    const result = await this.pool.query(
      `SELECT route_metadata AS "routeMetadata"
       FROM rides
       WHERE id = $1`,
      [id],
    );

    if (!result.rows[0]?.routeMetadata) {
      return null;
    }

    return result.rows[0].routeMetadata as RouteMetadata;
  }

  async getDestination(id: string): Promise<{ latitude: number; longitude: number } | null> {
    const result = await this.pool.query(
      `SELECT
         ST_Y(destination_location::geometry) AS latitude,
         ST_X(destination_location::geometry) AS longitude
       FROM rides
       WHERE id = $1`,
      [id],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      latitude: Number(result.rows[0].latitude),
      longitude: Number(result.rows[0].longitude),
    };
  }

  async updateRouteMetadata(id: string, metadata: RouteMetadata): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE rides
       SET route_metadata = COALESCE(route_metadata, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [id, JSON.stringify(metadata)],
    );

    return result.rowCount === 1;
  }

  async getRidePin(id: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT route_metadata->>'pin' AS pin
       FROM rides
       WHERE id = $1`,
      [id],
    );

    return (result.rows[0]?.pin as string) ?? null;
  }

  async markPinVerified(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE rides
       SET route_metadata = jsonb_set(
         COALESCE(route_metadata, '{}'::jsonb),
         '{pinVerified}',
         'true'::jsonb
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async isPinVerified(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT (route_metadata->>'pinVerified')::boolean AS verified
       FROM rides
       WHERE id = $1`,
      [id],
    );

    return result.rows[0]?.verified === true;
  }

  async listAvailable(limit = 20): Promise<Ride[]> {
    const result = await this.pool.query(
      `SELECT ${detailedRideColumns('r')}
       FROM rides r
       ${detailedRideJoins('r')}
       WHERE r.status = 'searching'
         AND r.assigned_driver_id IS NULL
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => mapRide(row, false));
  }

  async listForDriver(driverProfileId: string, limit = 20): Promise<Ride[]> {
    const result = await this.pool.query(
      `SELECT ${detailedRideColumns('r')}
       FROM rides r
       ${detailedRideJoins('r')}
       WHERE r.assigned_driver_id = $1
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $2`,
      [driverProfileId, limit],
    );

    return result.rows.map((row) => mapRide(row, false));
  }
}
