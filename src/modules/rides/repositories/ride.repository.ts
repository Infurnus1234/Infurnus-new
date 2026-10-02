import { randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../../infrastructure/database/postgres.js';

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

  findById(id: string): Promise<Ride | null>;

  findByIdForCustomer(id: string, customerId: string): Promise<Ride | null>;

  listForCustomer(customerId: string, query: ListRidesInput): Promise<Ride[]>;

  cancel(id: string, customerId: string, reason: string, client?: PoolClient): Promise<Ride | null>;

  accept(id: string, driverProfileId: string, client?: PoolClient): Promise<Ride | null>;

  offerDispatch(rideId: string, driverProfileId: string, responseTimeoutMs: number): Promise<boolean>;

  finishDispatchAttempt(
    rideId: string,
    driverProfileId: string,
    status: 'rejected' | 'timed_out',
  ): Promise<boolean>;

  listAvailableForDriver(driverProfileId: string, limit?: number): Promise<Ride[]>;

  failDispatch(rideId: string, reason: string): Promise<Ride | null>;

  transition(
    id: string,
    status: Ride['status'],
    assignedDriverId?: string,
    client?: PoolClient,
  ): Promise<Ride | null>;

  complete(id: string, assignedDriverId: string, client?: PoolClient): Promise<Ride | null>;

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

  recordBreadcrumbAndAccumulateDistance(
    rideId: string,
    latitude: number,
    longitude: number,
    speed?: number,
    heading?: number,
    client?: PoolClient,
  ): Promise<{
    actualDistanceMeters: number;
    incrementalDistanceMeters: number;
  } | null>;
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
  COALESCE(
    ${tableAlias}.fare_estimate,
    (${tableAlias}.route_metadata->>'fareEstimate')::numeric
  ) AS "fareEstimate",
  ${tableAlias}.final_fare AS "finalFare",
  ${tableAlias}.actual_distance_meters AS "actualDistanceMeters",
  ${tableAlias}.actual_fuel_cost AS "actualFuelCost",
  COALESCE(
    ${tableAlias}.sector,
    ${tableAlias}.route_metadata->>'sector',
    'passenger'
  ) AS "sector",
  COALESCE(
    ${tableAlias}.vehicle_category,
    ${tableAlias}.route_metadata->>'vehicleCategory'
  ) AS "vehicleCategory",
  ${tableAlias}.route_metadata->'goods' AS "goods",
  ${tableAlias}.route_metadata->'serviceDetails' AS "serviceDetails",
  ${tableAlias}.route_metadata->'rentalDetails' AS "rentalDetails",
  COALESCE(
    ${tableAlias}.pin,
    ${tableAlias}.route_metadata->>'pin'
  ) AS "pin",
  ${tableAlias}.pin_verified AS "pinVerified",
  CASE
    WHEN ${tableAlias}.assigned_driver_id IS NOT NULL THEN
      NULLIF(
        TRIM(
          CONCAT(
            u.first_name,
            ' ',
            COALESCE(u.last_name, '')
          )
        ),
        ''
      )
    ELSE NULL
  END AS "driverName",
  u.phone AS "driverPhone",
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
  ${tableAlias}.updated_at AS "updatedAt"
`;

const detailedRideJoins = (tableAlias = 'r') => `
  LEFT JOIN driver_profiles dp
    ON dp.id = ${tableAlias}.assigned_driver_id
  LEFT JOIN users u
    ON u.id = dp.user_id
  LEFT JOIN vehicles v
    ON v.id = ${tableAlias}.assigned_vehicle_id
`;

function normalizeGoods(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const g = raw as Record<string, unknown>;

  const itemType = (g.itemType as string) || (g.category as string) || 'General Goods';

  const category = (g.category as string) || itemType;

  const description = (g.description as string) || (g.notes as string) || '';

  const weightKg = Number(g.weightKg ?? g.weight ?? 0);

  const quantity = Number(g.quantity ?? g.qty ?? 1);

  const hasLoadingAssistance = Boolean(g.hasLoadingAssistance ?? g.loadingAssistance ?? false);

  return {
    ...g,
    itemType,
    category,
    description,
    weightKg,
    quantity,
    hasLoadingAssistance,
    loadingAssistance: hasLoadingAssistance,
  };
}

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

    finalFare: row.finalFare != null ? Number(row.finalFare) : null,

    actualDistanceMeters: row.actualDistanceMeters != null ? Number(row.actualDistanceMeters) : 0,

    actualFuelCost: row.actualFuelCost != null ? Number(row.actualFuelCost) : null,

    sector: (row.sector as string | null) ?? 'passenger',

    vehicleCategory: (row.vehicleCategory as string | null) ?? null,

    goods: normalizeGoods(row.goods),

    serviceDetails: (row.serviceDetails as Record<string, unknown> | null) ?? null,

    rentalDetails: (row.rentalDetails as Record<string, unknown> | null) ?? null,

    pin:
      forCustomer && row.pin != null && row.status !== 'completed' && row.status !== 'cancelled'
        ? String(row.pin)
        : null,

    pinVerified: Boolean(row.pinVerified),

    driverDetails:
      row.assignedDriverId && row.driverName
        ? {
            id: row.assignedDriverId as string,
            name: row.driverName as string,
            phone: (row.driverPhone as string | null) ?? null,
            rating: row.driverRating != null ? Number(row.driverRating) : null,

            // Driver profile photo is resolved by
            // DriverDocumentStorageService in RideService.
            photoUrl: null,
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
         (
           customer_id,
           pickup_location,
           destination_location,
           pickup_address,
           destination_address,
           status,
           sector,
           vehicle_category,
           fare_estimate,
           pin,
           route_metadata
         )
         VALUES (
           $1,
           ST_SetSRID(
             ST_MakePoint($2, $3),
             4326
           )::geography,
           ST_SetSRID(
             ST_MakePoint($4, $5),
             4326
           )::geography,
           $6,
           $7,
           'searching',
           $9::varchar,
           $10::varchar,
           $8::numeric,
           $14::text,
           jsonb_build_object(
             'fareEstimate',
             $8::numeric,
             'sector',
             $9::text,
             'vehicleCategory',
             $10::text,
             'goods',
             $11::jsonb,
             'serviceDetails',
             $12::jsonb,
             'rentalDetails',
             $13::jsonb,
             'pin',
             $14::text,
             'lastCalculatedAt',
             null,
             'lastOrigin',
             null,
             'route',
             null
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
        input.goods ? JSON.stringify(normalizeGoods(input.goods)) : null,
        input.serviceDetails ? JSON.stringify(input.serviceDetails) : null,
        input.rentalDetails ? JSON.stringify(input.rentalDetails) : null,
        pin,
      ],
    );

    return mapRide(result.rows[0], true);
  }

  async findById(id: string): Promise<Ride | null> {
    const result = await this.pool.query(
      `SELECT ${detailedRideColumns('r')}
       FROM rides r
       ${detailedRideJoins('r')}
       WHERE r.id = $1`,
      [id],
    );

    return result.rows[0] ? mapRide(result.rows[0], false) : null;
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
         AND (
           $2::ride_status IS NULL
           OR r.status = $2
         )
         AND (
           $3::timestamptz IS NULL
           OR r.created_at < $3
         )
       ORDER BY
         r.created_at DESC,
         r.id DESC
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
         SET
           status = 'cancelled',
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
       ), accepted_attempt AS (
         UPDATE ride_dispatch_attempts attempt
         SET status = 'accepted', responded_at = NOW()
         FROM updated
         WHERE attempt.ride_id = updated.id
           AND attempt.driver_profile_id = $2
           AND attempt.status = 'offered'
         RETURNING attempt.ride_id AS id
       ), accepted AS (
         SELECT updated.*
         FROM updated
         JOIN accepted_attempt USING (id)
       )
       SELECT ${detailedRideColumns('u_r')}
       FROM accepted u_r
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
         SET
           assigned_driver_id = $2,
           assigned_vehicle_id = (
             SELECT v.id
             FROM vehicles v
             WHERE v.driver_profile_id = $2
               AND (
                 (
                   SELECT dp.active_vehicle_id
                   FROM driver_profiles dp
                   WHERE dp.id = $2
                 ) IS NULL
                 OR v.id = (
                   SELECT dp.active_vehicle_id
                   FROM driver_profiles dp
                   WHERE dp.id = $2
                 )
               )
               AND v.is_active = TRUE
               AND v.verification_status = 'approved'
               AND v.sector = r.sector
               AND v.category = r.vehicle_category
             ORDER BY v.created_at DESC
             LIMIT 1
           ),
           status = 'driver_assigned',
           dispatch_driver_id = NULL,
           dispatch_expires_at = NULL
         WHERE r.id = $1
           AND r.status = 'searching'
              AND EXISTS (
                SELECT 1
                FROM ride_dispatch_attempts offered
                WHERE offered.ride_id = r.id
                  AND offered.driver_profile_id = $2
                  AND offered.status = 'offered'
                  AND offered.expires_at > NOW()
              )
           AND EXISTS (
             SELECT 1
             FROM driver_profiles dp
             JOIN users u
               ON u.id = dp.user_id
             WHERE dp.id = $2
               AND u.status = 'active'
               AND dp.verification_status = 'approved'
               AND dp.availability_status = 'available'
               AND dp.last_location IS NOT NULL
               AND dp.last_location_at >= NOW() -
                 (
                   $3::int *
                   INTERVAL '1 second'
                 )
               AND ST_DWithin(
                 dp.last_location,
                 r.pickup_location,
                 $4
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM rides active_ride
                 WHERE active_ride.assigned_driver_id = dp.id
                   AND active_ride.status NOT IN ('completed', 'cancelled')
               )
           )
           AND EXISTS (
             SELECT 1
             FROM vehicles v
             WHERE v.driver_profile_id = $2
               AND (
                 (
                   SELECT dp.active_vehicle_id
                   FROM driver_profiles dp
                   WHERE dp.id = $2
                 ) IS NULL
                 OR v.id = (
                   SELECT dp.active_vehicle_id
                   FROM driver_profiles dp
                   WHERE dp.id = $2
                 )
               )
               AND v.is_active = TRUE
               AND v.verification_status = 'approved'
               AND v.sector = r.sector
               AND v.category = r.vehicle_category
           )
         RETURNING *
       ), accepted_attempt AS (
         UPDATE ride_dispatch_attempts attempt
         SET status = 'accepted', responded_at = NOW()
         FROM updated
         WHERE attempt.ride_id = updated.id
           AND attempt.driver_profile_id = $2
           AND attempt.status = 'offered'
         RETURNING attempt.ride_id AS id
       ), accepted AS (
         SELECT updated.*
         FROM updated
         JOIN accepted_attempt USING (id)
       )
       SELECT ${detailedRideColumns('u_r')}
       FROM accepted u_r
       ${detailedRideJoins('u_r')}`,
      [
        id,
        driverProfileId,
        env.DRIVER_LOCATION_STALE_SECONDS,
        env.DRIVER_SEARCH_RADIUS_METERS,
      ],
    );

    return result.rows[0] ? mapRide(result.rows[0], false) : null;
  }

  async offerDispatch(
    rideId: string,
    driverProfileId: string,
    responseTimeoutMs: number,
  ): Promise<boolean> {
    return withTransaction(async (client) => {
      const lockedDriver = await client.query(
        `SELECT id FROM driver_profiles WHERE id = $1 FOR UPDATE`,
        [driverProfileId],
      );
      if (lockedDriver.rowCount !== 1) return false;

      await client.query(
        `UPDATE ride_dispatch_attempts attempt
         SET status = 'timed_out', responded_at = NOW()
         FROM rides r
         WHERE r.id = $1
           AND r.dispatch_expires_at <= NOW()
           AND attempt.ride_id = r.id
           AND attempt.driver_profile_id = r.dispatch_driver_id
           AND attempt.status = 'offered'`,
        [rideId],
      );
      await client.query(
        `UPDATE rides
         SET dispatch_driver_id = NULL, dispatch_expires_at = NULL
         WHERE id = $1 AND dispatch_expires_at <= NOW()`,
        [rideId],
      );

      const leased = await client.query<{ attempt: number }>(
        `UPDATE rides r
         SET dispatch_driver_id = $2,
             dispatch_expires_at = NOW() + ($3::int * INTERVAL '1 millisecond'),
             dispatch_attempt = dispatch_attempt + 1
         WHERE r.id = $1
           AND r.status = 'searching'
           AND r.assigned_driver_id IS NULL
           AND r.dispatch_driver_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM ride_dispatch_attempts previous
             WHERE previous.ride_id = r.id
               AND previous.driver_profile_id = $2
           )
           AND EXISTS (
             SELECT 1
             FROM driver_profiles dp
             JOIN users u ON u.id = dp.user_id
             JOIN vehicles v ON v.driver_profile_id = dp.id
             WHERE dp.id = $2
               AND u.status = 'active'
               AND dp.verification_status = 'approved'
               AND dp.availability_status = 'available'
               AND dp.last_location IS NOT NULL
               AND dp.last_location_at >= NOW() - ($4::int * INTERVAL '1 second')
               AND v.is_active = TRUE
               AND v.verification_status = 'approved'
               AND v.sector = r.sector
               AND v.category = r.vehicle_category
               AND (
                 dp.active_vehicle_id IS NULL
                 OR dp.active_vehicle_id = v.id
               )
               AND ST_DWithin(dp.last_location, r.pickup_location, $5)
               AND NOT EXISTS (
                 SELECT 1 FROM rides active_ride
                 WHERE active_ride.assigned_driver_id = dp.id
                   AND active_ride.status NOT IN ('completed', 'cancelled')
               )
               AND NOT EXISTS (
                 SELECT 1 FROM rides pending_offer
                 WHERE pending_offer.dispatch_driver_id = dp.id
                   AND pending_offer.dispatch_expires_at > NOW()
                   AND pending_offer.status = 'searching'
               )
           )
         RETURNING dispatch_attempt AS attempt`,
        [
          rideId,
          driverProfileId,
          responseTimeoutMs,
          env.DRIVER_LOCATION_STALE_SECONDS,
          env.DRIVER_SEARCH_RADIUS_METERS,
        ],
      );
      const attempt = leased.rows[0]?.attempt;
      if (attempt === undefined) return false;

      await client.query(
        `INSERT INTO ride_dispatch_attempts (
           ride_id, attempt, driver_profile_id, status, expires_at
         )
         SELECT id, dispatch_attempt, dispatch_driver_id, 'offered', dispatch_expires_at
         FROM rides
         WHERE id = $1 AND dispatch_attempt = $2`,
        [rideId, attempt],
      );
      return true;
    });
  }

  async finishDispatchAttempt(
    rideId: string,
    driverProfileId: string,
    status: 'rejected' | 'timed_out',
  ): Promise<boolean> {
    return withTransaction(async (client) => {
      const lease = await client.query<{ id: string }>(
        `SELECT id
         FROM rides
         WHERE id = $1
           AND status = 'searching'
           AND dispatch_driver_id = $2
         FOR UPDATE`,
        [rideId, driverProfileId],
      );
      if (!lease.rows[0]) return false;

      const attempt = await client.query(
        `UPDATE ride_dispatch_attempts
         SET status = $3, responded_at = NOW()
         WHERE ride_id = $1
           AND driver_profile_id = $2
           AND status = 'offered'
         RETURNING ride_id`,
        [rideId, driverProfileId, status],
      );
      if (attempt.rowCount !== 1) return false;

      await client.query(
        `UPDATE rides
         SET dispatch_driver_id = NULL, dispatch_expires_at = NULL
         WHERE id = $1 AND dispatch_driver_id = $2 AND status = 'searching'`,
        [rideId, driverProfileId],
      );
      return true;
    });
  }

  async listAvailableForDriver(driverProfileId: string, limit = 20): Promise<Ride[]> {
    const result = await this.pool.query(
      `SELECT ${detailedRideColumns('r')}
       FROM rides r
       ${detailedRideJoins('r')}
       WHERE r.status = 'searching'
         AND r.assigned_driver_id IS NULL
         AND r.dispatch_driver_id = $1
         AND r.dispatch_expires_at > NOW()
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $2`,
      [driverProfileId, limit],
    );
    return result.rows.map((row) => mapRide(row, false));
  }

  async failDispatch(rideId: string, reason: string): Promise<Ride | null> {
    const result = await this.pool.query(
      `WITH failed AS (
         UPDATE rides r
         SET status = 'cancelled',
             cancellation_reason = $2,
             cancelled_at = NOW(),
             dispatch_driver_id = NULL,
             dispatch_expires_at = NULL
         WHERE r.id = $1
           AND r.status = 'searching'
           AND r.assigned_driver_id IS NULL
           AND r.dispatch_driver_id IS NULL
         RETURNING r.*
       )
       SELECT ${detailedRideColumns('failed')}
       FROM failed
       ${detailedRideJoins('failed')}`,
      [rideId, reason],
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
           AND (
             $3::uuid IS NULL
             OR assigned_driver_id = $3
           )
         RETURNING *
       )
       SELECT ${detailedRideColumns('u_r')}
       FROM updated u_r
       ${detailedRideJoins('u_r')}`,
      [id, status, assignedDriverId ?? null],
    );

    return result.rows[0] ? mapRide(result.rows[0], false) : null;
  }

  async complete(
    id: string,
    assignedDriverId: string,
    client: PoolClient | Pool = this.pool,
  ): Promise<Ride | null> {
    const queryRunner = client && typeof client.query === 'function' ? client : this.pool;

    const result = await queryRunner.query(
      `WITH current_ride AS (
         SELECT
           r.id,
           r.sector,
           r.actual_distance_meters,
           r.route_metadata,
           r.fare_estimate,
           v.fuel_rate_per_km
         FROM rides r
         LEFT JOIN vehicles v
           ON v.id = r.assigned_vehicle_id
         WHERE r.id = $1
           AND r.assigned_driver_id = $2
           AND r.status = 'in_progress'
         FOR UPDATE OF r
       ),
       updated AS (
         UPDATE rides r
         SET
           status = 'completed',
           completed_at = NOW(),
           actual_fuel_cost = CASE
             WHEN cr.sector = 'premium' THEN
               ROUND(
                 (
                   (
                     cr.actual_distance_meters::numeric /
                     1000.0
                   ) *
                   COALESCE(
                     NULLIF(
                       cr.fuel_rate_per_km,
                       0
                     ),
                     15.00
                   )
                 ),
                 2
               )
             ELSE NULL
           END,
           final_fare = CASE
             WHEN cr.sector = 'premium' THEN
               ROUND(
                 (
                   (
                     GREATEST(
                       1,
                       COALESCE(
                         (
                           cr.route_metadata
                             ->'rentalDetails'
                             ->>'rentalHours'
                         )::numeric,
                         (
                           cr.route_metadata
                             ->'rentalDetails'
                             ->>'hours'
                         )::numeric,
                         1
                       )
                     ) * 1000.0
                   )
                   +
                   (
                     (
                       cr.actual_distance_meters::numeric /
                       1000.0
                     ) *
                     COALESCE(
                       NULLIF(
                         cr.fuel_rate_per_km,
                         0
                       ),
                       15.00
                     )
                   )
                 ) * 1.05,
                 2
               )
             ELSE
               COALESCE(
                 r.final_fare,
                 r.fare_estimate
               )
           END,
           updated_at = NOW()
         FROM current_ride cr
         WHERE r.id = cr.id
         RETURNING r.*
       )
       SELECT ${detailedRideColumns('u_r')}
       FROM updated u_r
       ${detailedRideJoins('u_r')}`,
      [id, assignedDriverId],
    );

    return result.rows[0] ? mapRide(result.rows[0], false) : null;
  }

  async recordBreadcrumbAndAccumulateDistance(
    rideId: string,
    latitude: number,
    longitude: number,
    speed?: number,
    heading?: number,
    client: PoolClient | Pool = this.pool,
  ): Promise<{
    actualDistanceMeters: number;
    incrementalDistanceMeters: number;
  } | null> {
    const result = await client.query(
      `WITH target_ride AS (
         SELECT
           id,
           actual_distance_meters
         FROM rides
         WHERE id = $1
           AND status = 'in_progress'
         FOR UPDATE
       ),
       last_crumb AS (
         SELECT location
         FROM ride_location_breadcrumbs
         WHERE ride_id = $1
         ORDER BY
           recorded_at DESC,
           id DESC
         LIMIT 1
       ),
       new_crumb AS (
         INSERT INTO ride_location_breadcrumbs
         (
           ride_id,
           location,
           speed,
           heading
         )
         SELECT
           tr.id,
           ST_SetSRID(
             ST_MakePoint($3, $2),
             4326
           )::geography,
           $4,
           $5
         FROM target_ride tr
         RETURNING
           id,
           ride_id,
           location
       ),
       distance_calc AS (
         SELECT
           COALESCE(
             ROUND(
               ST_Distance(
                 lc.location,
                 nc.location
               )
             )::int,
             0
           ) AS delta_meters
         FROM new_crumb nc
         LEFT JOIN last_crumb lc
           ON true
       )
       UPDATE rides r
       SET
         actual_distance_meters =
           r.actual_distance_meters +
           CASE
             WHEN dc.delta_meters > 1
               THEN dc.delta_meters
             ELSE 0
           END,
         updated_at = NOW()
       FROM distance_calc dc
       WHERE r.id = $1
       RETURNING
         r.actual_distance_meters AS "actualDistanceMeters",
         dc.delta_meters AS "incrementalDistanceMeters"`,
      [rideId, latitude, longitude, speed ?? null, heading ?? null],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      actualDistanceMeters: Number(result.rows[0].actualDistanceMeters),
      incrementalDistanceMeters: Number(result.rows[0].incrementalDistanceMeters),
    };
  }

  async isParticipant(id: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM rides r
       LEFT JOIN driver_profiles dp
         ON dp.id = r.assigned_driver_id
       WHERE r.id = $1
         AND (
           r.customer_id = $2
           OR dp.user_id = $2
         )`,
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
      `SELECT
         route_metadata AS "routeMetadata"
       FROM rides
       WHERE id = $1`,
      [id],
    );

    if (!result.rows[0]?.routeMetadata) {
      return null;
    }

    return result.rows[0].routeMetadata as RouteMetadata;
  }

  async getDestination(id: string): Promise<{
    latitude: number;
    longitude: number;
  } | null> {
    const result = await this.pool.query(
      `SELECT
         ST_Y(
           destination_location::geometry
         ) AS latitude,
         ST_X(
           destination_location::geometry
         ) AS longitude
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
       SET
         route_metadata =
           COALESCE(
             route_metadata,
             '{}'::jsonb
           ) ||
           $2::jsonb,
         updated_at = NOW()
       WHERE id = $1`,
      [id, JSON.stringify(metadata)],
    );

    return result.rowCount === 1;
  }

  async getRidePin(id: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT
         COALESCE(
           pin,
           route_metadata->>'pin'
         ) AS pin
       FROM rides
       WHERE id = $1`,
      [id],
    );

    return (result.rows[0]?.pin as string) ?? null;
  }

  async markPinVerified(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE rides
       SET
         pin_verified = TRUE,
         route_metadata = jsonb_set(
           COALESCE(
             route_metadata,
             '{}'::jsonb
           ),
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
      `SELECT
         COALESCE(
           pin_verified,
           (
             route_metadata
               ->>'pinVerified'
           )::boolean,
           FALSE
         ) AS verified
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
       ORDER BY
         r.created_at DESC,
         r.id DESC
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
       ORDER BY
         r.created_at DESC,
         r.id DESC
       LIMIT $2`,
      [driverProfileId, limit],
    );

    return result.rows.map((row) => mapRide(row, false));
  }
}
