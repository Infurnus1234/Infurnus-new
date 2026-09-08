import type { Pool, PoolClient } from 'pg';
import type { DriverAvailabilityStatus, DriverCandidate, DriverLocation } from '../types/driver.js';

export interface DriverRepository {
  findProfileIdByUserId(userId: string): Promise<string | null>;
  getAvailability(profileId: string): Promise<DriverAvailabilityStatus | null>;
  updateAvailability(profileId: string, status: DriverAvailabilityStatus): Promise<boolean>;
  setBusy(profileId: string, client?: PoolClient): Promise<boolean>;
  updateLocation(profileId: string, location: DriverLocation): Promise<boolean>;
  markStale(profileId: string): Promise<boolean>;
  findNearbyEligible(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit: number,
    staleBefore: Date,
  ): Promise<DriverCandidate[]>;
}

export class PostgresDriverRepository implements DriverRepository {
  constructor(private readonly pool: Pool) {}

  async findProfileIdByUserId(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM driver_profiles WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0]?.id ?? null;
  }

  async getAvailability(profileId: string): Promise<DriverAvailabilityStatus | null> {
    const result = await this.pool.query<{ availabilityStatus: DriverAvailabilityStatus }>(
      `SELECT availability_status AS "availabilityStatus" FROM driver_profiles WHERE id = $1`,
      [profileId],
    );
    return result.rows[0]?.availabilityStatus ?? null;
  }

  async updateAvailability(profileId: string, status: DriverAvailabilityStatus): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE driver_profiles SET availability_status = $2
       WHERE id = $1 AND user_id IS NOT NULL
       RETURNING id`,
      [profileId, status],
    );
    return result.rowCount === 1;
  }

  async setBusy(profileId: string, client?: PoolClient): Promise<boolean> {
    const executor = client ?? this.pool;
    const result = await executor.query(
      `UPDATE driver_profiles SET availability_status = 'busy'
       WHERE id = $1 AND availability_status = 'available' RETURNING id`,
      [profileId],
    );
    return result.rowCount === 1;
  }

  async updateLocation(profileId: string, location: DriverLocation): Promise<boolean> {
    const executor: Pool | PoolClient = this.pool;
    const result = await executor.query(
      `UPDATE driver_profiles
       SET last_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
           last_location_at = $4,
           availability_status = CASE
             WHEN availability_status = 'stale' THEN 'available'::driver_availability_status
             ELSE availability_status
           END
       WHERE id = $1
         AND (last_location_at IS NULL OR last_location_at < $4)
       RETURNING id`,
      [profileId, location.longitude, location.latitude, location.recordedAt],
    );
    return result.rowCount === 1;
  }

  async markStale(profileId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE driver_profiles SET availability_status = 'stale'
       WHERE id = $1 AND availability_status IN ('available', 'busy')
       RETURNING id`,
      [profileId],
    );
    return result.rowCount === 1;
  }

  async findNearbyEligible(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit: number,
    staleBefore: Date,
  ): Promise<DriverCandidate[]> {
    const result = await this.pool.query<DriverCandidate>(
      `SELECT dp.id AS "driverProfileId", dp.user_id AS "userId", v.id AS "vehicleId",
          ST_Distance(dp.last_location, pickup.point) AS "distanceMeters",
          ST_Y(dp.last_location::geometry) AS latitude,
          ST_X(dp.last_location::geometry) AS longitude,
          dp.availability_status AS "availabilityStatus",
          dp.verification_status AS "verificationStatus",
          dp.last_location_at AS "locationRecordedAt",
          COUNT(active_ride.id)::int AS "activeRideCount"
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id AND u.status = 'active'
       JOIN vehicles v ON v.driver_profile_id = dp.id AND v.is_active = TRUE
       CROSS JOIN LATERAL (
         SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS point
       ) pickup
       LEFT JOIN rides active_ride
         ON active_ride.assigned_driver_id = dp.id
        AND active_ride.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress')
       WHERE dp.availability_status = 'available'
         AND dp.verification_status = 'approved'
         AND dp.last_location IS NOT NULL
         AND dp.last_location_at >= $5
         AND ST_DWithin(dp.last_location, pickup.point, $3)
       GROUP BY dp.id, dp.user_id, v.id, pickup.point
       ORDER BY ST_Distance(dp.last_location, pickup.point), dp.id
       LIMIT $4`,
      [longitude, latitude, radiusMeters, limit, staleBefore],
    );
    return result.rows;
  }
}
