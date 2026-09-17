import type { Pool, PoolClient } from 'pg';
import type {
  DriverAvailabilityStatus,
  DriverCandidate,
  DriverLocation,
  DriverProfile,
} from '../types/driver.js';
import type { UpsertDriverProfileInput } from '../schemas/driver.schemas.js';

export interface DriverRepository {
  findProfileIdByUserId(userId: string): Promise<string | null>;
  findProfileByUserId(userId: string): Promise<DriverProfile | null>;
  upsertProfile(userId: string, input: UpsertDriverProfileInput): Promise<DriverProfile>;
  getAvailability(profileId: string): Promise<DriverAvailabilityStatus | null>;
  updateAvailability(profileId: string, status: DriverAvailabilityStatus): Promise<boolean>;
  setBusy(profileId: string, client?: PoolClient): Promise<boolean>;
  releaseBusy(profileId: string, client?: PoolClient): Promise<boolean>;
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

  async findProfileByUserId(userId: string): Promise<DriverProfile | null> {
    const result = await this.pool.query<DriverProfile>(
      `SELECT id, user_id AS "userId", license_number AS "licenseNumber",
              license_expiry::text AS "licenseExpiry", license_document_key AS "licenseDocumentKey",
              vehicle_rc_document_key AS "vehicleRcDocumentKey", profile_photo_key AS "profilePhotoKey",
              verification_status AS "verificationStatus", rejection_reason AS "rejectionReason",
              availability_status AS "availabilityStatus", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM driver_profiles WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async upsertProfile(userId: string, input: UpsertDriverProfileInput): Promise<DriverProfile> {
    const result = await this.pool.query<DriverProfile>(
      `INSERT INTO driver_profiles (user_id, license_number, license_expiry, profile_photo_key, license_document_key, vehicle_rc_document_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
       SET license_number = EXCLUDED.license_number,
           license_expiry = EXCLUDED.license_expiry,
           profile_photo_key = COALESCE(EXCLUDED.profile_photo_key, driver_profiles.profile_photo_key),
           license_document_key = COALESCE(EXCLUDED.license_document_key, driver_profiles.license_document_key),
           vehicle_rc_document_key = COALESCE(EXCLUDED.vehicle_rc_document_key, driver_profiles.vehicle_rc_document_key),
           updated_at = NOW()
       RETURNING id, user_id AS "userId", license_number AS "licenseNumber",
                 license_expiry::text AS "licenseExpiry", license_document_key AS "licenseDocumentKey",
                 vehicle_rc_document_key AS "vehicleRcDocumentKey", profile_photo_key AS "profilePhotoKey",
                 verification_status AS "verificationStatus", rejection_reason AS "rejectionReason",
                 availability_status AS "availabilityStatus", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        userId,
        input.licenseNumber,
        input.licenseExpiry,
        input.profilePhotoKey ?? null,
        input.licenseDocumentKey ?? null,
        input.vehicleRcDocumentKey ?? null,
      ],
    );
    const profile = result.rows[0];
    if (!profile) throw new Error('Driver profile upsert returned no row');
    return profile;
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

  async releaseBusy(profileId: string, client?: PoolClient): Promise<boolean> {
    const executor = client ?? this.pool;
    const result = await executor.query(
      `UPDATE driver_profiles
       SET availability_status = 'available'
       WHERE id = $1
         AND availability_status = 'busy'
       RETURNING id`,
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
             WHEN availability_status = 'stale'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM rides
                    WHERE assigned_driver_id = driver_profiles.id
                      AND status NOT IN ('completed', 'cancelled')
                  )
               THEN 'available'::driver_availability_status
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
         AND active_ride.id IS NULL
       GROUP BY dp.id, dp.user_id, v.id, pickup.point
       ORDER BY ST_Distance(dp.last_location, pickup.point), dp.id
       LIMIT $4`,
      [longitude, latitude, radiusMeters, limit, staleBefore],
    );
    return result.rows;
  }
}
