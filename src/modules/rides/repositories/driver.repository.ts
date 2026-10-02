import type { Pool, PoolClient } from 'pg';
import type {
  DriverAvailabilityStatus,
  DriverCandidate,
  DriverLocation,
  DriverProfile,
} from '../types/driver.js';
import type { UpsertDriverProfileInput } from '../schemas/driver.schemas.js';

export interface AssignmentCodePreview {
  code: string;
  vehicle: {
    id: string;
    make: string;
    model: string;
    plateNumber: string;
    color: string | null;
    sector: string;
    category: string;
  };
  owner: {
    id: string;
    name: string;
    businessName?: string | null;
  };
}

export interface DriverRepository {
  findProfileIdByUserId(userId: string): Promise<string | null>;

  findProfileByUserId(userId: string): Promise<DriverProfile | null>;

  findProfileById(profileId: string): Promise<DriverProfile | null>;

  upsertProfile(userId: string, input: UpsertDriverProfileInput): Promise<DriverProfile>;

  updateVerificationStatus(
    profileId: string,
    status: 'pending' | 'under_review' | 'approved' | 'rejected',
    rejectionReason?: string | null,
    verifiedBy?: string | null,
  ): Promise<boolean>;

  getAvailability(profileId: string): Promise<DriverAvailabilityStatus | null>;

  updateAvailability(profileId: string, status: DriverAvailabilityStatus): Promise<boolean>;

  setBusy(profileId: string, client?: PoolClient): Promise<boolean>;

  releaseBusy(profileId: string, client?: PoolClient): Promise<boolean>;

  updateLocation(profileId: string, location: DriverLocation): Promise<boolean>;

  markStale(profileId: string): Promise<boolean>;

  findActiveVehicleByUserId?(userId: string): Promise<{
    sector: string;
    category: string;
  } | null>;

  findNearbyEligible(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit: number,
    staleBefore: Date,
    sector?: string,
    vehicleCategory?: string,
  ): Promise<DriverCandidate[]>;

  verifyAssignmentCode(code: string): Promise<AssignmentCodePreview | null>;

  claimAssignmentCode(
    code: string,
    driverUserId: string,
    driverProfileId: string,
  ): Promise<{
    vehicleId: string;
    make: string;
    model: string;
    plateNumber: string;
  }>;

  setActiveVehicle(driverProfileId: string, vehicleId: string): Promise<boolean>;

  getAssignedVehicle(driverProfileId: string): Promise<{
    id: string;
    make: string;
    model: string;
    plateNumber: string;
    color: string | null;
    sector: string;
    category: string;
  } | null>;
}

const driverProjection = `
  id,
  user_id AS "userId",
  license_number AS "licenseNumber",
  license_expiry::text AS "licenseExpiry",
  verification_status AS "verificationStatus",
  rejection_reason AS "rejectionReason",
  availability_status AS "availabilityStatus",
  dob::text AS "dob",
  gender,
  address,
  city,
  state,
  pin_code AS "pinCode",
  emergency_contact_name AS "emergencyContactName",
  emergency_contact_phone AS "emergencyContactPhone",
  active_vehicle_id AS "activeVehicleId",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export class PostgresDriverRepository implements DriverRepository {
  constructor(private readonly pool: Pool) {}

  async findProfileIdByUserId(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
       FROM driver_profiles
       WHERE user_id = $1`,
      [userId],
    );

    return result.rows[0]?.id ?? null;
  }

  async findProfileByUserId(userId: string): Promise<DriverProfile | null> {
    const result = await this.pool.query<DriverProfile>(
      `SELECT ${driverProjection}
       FROM driver_profiles
       WHERE user_id = $1`,
      [userId],
    );

    return result.rows[0] ?? null;
  }

  async findProfileById(profileId: string): Promise<DriverProfile | null> {
    const result = await this.pool.query<DriverProfile>(
      `SELECT ${driverProjection}
       FROM driver_profiles
       WHERE id = $1`,
      [profileId],
    );

    return result.rows[0] ?? null;
  }

  async upsertProfile(userId: string, input: UpsertDriverProfileInput): Promise<DriverProfile> {
    const result = await this.pool.query<DriverProfile>(
      `INSERT INTO driver_profiles (
         user_id,
         license_number,
         license_expiry,
         dob,
         gender,
         address,
         city,
         state,
         pin_code,
         emergency_contact_name,
         emergency_contact_phone
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12
       )
       ON CONFLICT (user_id) DO UPDATE
       SET license_number = EXCLUDED.license_number,
           license_expiry = EXCLUDED.license_expiry,
           dob = COALESCE(
             EXCLUDED.dob,
             driver_profiles.dob
           ),
           gender = COALESCE(
             EXCLUDED.gender,
             driver_profiles.gender
           ),
           address = COALESCE(
             EXCLUDED.address,
             driver_profiles.address
           ),
           city = COALESCE(
             EXCLUDED.city,
             driver_profiles.city
           ),
           state = COALESCE(
             EXCLUDED.state,
             driver_profiles.state
           ),
           pin_code = COALESCE(
             EXCLUDED.pin_code,
             driver_profiles.pin_code
           ),
           emergency_contact_name = COALESCE(
             EXCLUDED.emergency_contact_name,
             driver_profiles.emergency_contact_name
           ),
           emergency_contact_phone = COALESCE(
             EXCLUDED.emergency_contact_phone,
             driver_profiles.emergency_contact_phone
           ),
           updated_at = NOW()
       RETURNING ${driverProjection}`,
      [
        userId,
        input.licenseNumber,
        input.licenseExpiry,
        input.dob ?? null,
        input.gender ?? null,
        input.address ?? null,
        input.city ?? null,
        input.state ?? null,
        input.pinCode ?? null,
        input.emergencyContactName ?? null,
        input.emergencyContactPhone ?? null,
      ],
    );

    const profile = result.rows[0];

    if (!profile) {
      throw new Error('Driver profile upsert returned no row');
    }

    return profile;
  }

  async updateVerificationStatus(
    profileId: string,
    status: 'pending' | 'under_review' | 'approved' | 'rejected',
    rejectionReason?: string | null,
    verifiedBy?: string | null,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE driver_profiles
       SET verification_status = $2::driver_verification_status,
           rejection_reason = $3,
           verified_by = $4,
           verified_at = CASE
             WHEN $2::driver_verification_status IN ('approved', 'rejected')
               THEN NOW()
             ELSE verified_at
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [profileId, status, rejectionReason ?? null, verifiedBy ?? null],
    );

    return result.rowCount === 1;
  }

  async getAvailability(profileId: string): Promise<DriverAvailabilityStatus | null> {
    const result = await this.pool.query<{
      availabilityStatus: DriverAvailabilityStatus;
    }>(
      `SELECT availability_status AS "availabilityStatus"
       FROM driver_profiles
       WHERE id = $1`,
      [profileId],
    );

    return result.rows[0]?.availabilityStatus ?? null;
  }

  async updateAvailability(profileId: string, status: DriverAvailabilityStatus): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE driver_profiles
       SET availability_status = $2
       WHERE id = $1
         AND user_id IS NOT NULL
       RETURNING id`,
      [profileId, status],
    );

    return result.rowCount === 1;
  }

  async setBusy(profileId: string, client?: PoolClient): Promise<boolean> {
    const executor = client ?? this.pool;

    const result = await executor.query(
      `UPDATE driver_profiles
       SET availability_status = 'busy'
       WHERE id = $1
         AND availability_status = 'available'
       RETURNING id`,
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
       SET last_location =
             ST_SetSRID(
               ST_MakePoint($2, $3),
               4326
             )::geography,
           last_location_at = $4,
           availability_status = CASE
             WHEN availability_status = 'stale'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM rides
                    WHERE assigned_driver_id = driver_profiles.id
                      AND status NOT IN (
                        'completed',
                        'cancelled'
                      )
                  )
               THEN 'available'::driver_availability_status
             ELSE availability_status
           END
       WHERE id = $1
         AND (
           last_location_at IS NULL
           OR last_location_at < $4
         )
       RETURNING id`,
      [profileId, location.longitude, location.latitude, location.recordedAt],
    );

    return result.rowCount === 1;
  }

  async markStale(profileId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE driver_profiles
       SET availability_status = 'stale'
       WHERE id = $1
         AND availability_status IN (
           'available',
           'busy'
         )
       RETURNING id`,
      [profileId],
    );

    return result.rowCount === 1;
  }

  async findActiveVehicleByUserId(userId: string): Promise<{
    sector: string;
    category: string;
  } | null> {
    const result = await this.pool.query<{
      sector: string;
      category: string;
    }>(
      `SELECT
         COALESCE(v.sector, 'passenger') AS "sector",
         COALESCE(v.category, 'sedan') AS "category"
       FROM driver_profiles dp
       JOIN vehicles v
         ON v.id = COALESCE(
           dp.active_vehicle_id,
           (
             SELECT id
             FROM vehicles v2
             WHERE v2.driver_profile_id = dp.id
               AND v2.is_active = TRUE
               AND v2.verification_status = 'approved'
             ORDER BY v2.created_at DESC
             LIMIT 1
           )
         )
       WHERE dp.user_id = $1
         AND v.driver_profile_id = dp.id
         AND v.is_active = TRUE
         AND v.verification_status = 'approved'
       LIMIT 1`,
      [userId],
    );

    return result.rows[0] ?? null;
  }

  async findNearbyEligible(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit: number,
    staleBefore: Date,
    sector?: string,
    vehicleCategory?: string,
  ): Promise<DriverCandidate[]> {
    const values: unknown[] = [longitude, latitude, radiusMeters, staleBefore, limit];

    const conditions: string[] = [
      `dp.availability_status = 'available'`,
      `dp.verification_status = 'approved'`,
      `dp.last_location IS NOT NULL`,
      `dp.last_location_at >= $4`,
      `v.is_active = TRUE`,
      `v.verification_status = 'approved'`,
      `v.driver_profile_id = dp.id`,
      `NOT EXISTS (
         SELECT 1
         FROM rides pending_offer
         WHERE pending_offer.dispatch_driver_id = dp.id
           AND pending_offer.dispatch_expires_at > NOW()
           AND pending_offer.status = 'searching'
       )`,
    ];

    if (sector) {
      values.push(sector);
      conditions.push(`v.sector = $${values.length}`);
    }

    if (vehicleCategory) {
      values.push(vehicleCategory);
      conditions.push(`v.category = $${values.length}`);
    }

    const fallbackVehicleConditions = [
      'v2.driver_profile_id = dp.id',
      'v2.is_active = TRUE',
      "v2.verification_status = 'approved'",
      ...(sector ? [`v2.sector = $${values.indexOf(sector) + 1}`] : []),
      ...(vehicleCategory ? [`v2.category = $${values.indexOf(vehicleCategory) + 1}`] : []),
    ];

    const result = await this.pool.query<DriverCandidate>(
      `SELECT
           dp.id AS "driverProfileId",
           dp.user_id AS "userId",
           v.id AS "vehicleId",
           ST_Distance(
             dp.last_location,
             ST_SetSRID(
               ST_MakePoint($1, $2),
               4326
             )::geography
           ) AS "distanceMeters",
           ST_Y(dp.last_location::geometry) AS latitude,
           ST_X(dp.last_location::geometry) AS longitude,
           dp.availability_status AS "availabilityStatus",
           dp.verification_status AS "verificationStatus",
           COALESCE(active_rides.count, 0)::int AS "activeRideCount",
           dp.last_location_at AS "locationRecordedAt",
           v.sector AS sector,
           v.category AS "vehicleCategory"
         FROM driver_profiles dp
         JOIN users u
           ON u.id = dp.user_id
          AND u.status = 'active'
         JOIN vehicles v
           ON v.id = COALESCE(
             dp.active_vehicle_id,
             (
               SELECT id
               FROM vehicles v2
               WHERE ${fallbackVehicleConditions.join('\n                 AND ')}
               ORDER BY v2.created_at DESC
               LIMIT 1
             )
           )
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS count
           FROM rides r
           WHERE r.assigned_driver_id = dp.id
             AND r.status NOT IN (
               'completed',
               'cancelled'
             )
         ) active_rides ON TRUE
         WHERE ${conditions.join('\nAND ')}
           AND COALESCE(active_rides.count, 0) = 0
           AND ST_DWithin(
             dp.last_location,
             ST_SetSRID(
               ST_MakePoint($1, $2),
               4326
             )::geography,
             $3
           )
         ORDER BY "distanceMeters" ASC
         LIMIT $5`,
      values,
    );

    return result.rows;
  }

  async verifyAssignmentCode(code: string): Promise<AssignmentCodePreview | null> {
    const result = await this.pool.query<AssignmentCodePreview>(
      `SELECT
           dac.code,
           json_build_object(
             'id', v.id,
             'make', v.make,
             'model', v.model,
             'plateNumber', v.plate_number,
             'color', v.color,
             'sector', v.sector,
             'category', v.category
           ) AS vehicle,
           json_build_object(
             'id', u.id,
             'name', u.name,
             'businessName', p.business_name
           ) AS owner
         FROM driver_assignment_codes dac
         JOIN vehicles v
           ON v.id = dac.vehicle_id
         JOIN users u
           ON u.id = dac.fleet_owner_id
         LEFT JOIN partners p
           ON p.user_id = u.id
         WHERE dac.code = $1
           AND dac.status = 'ACTIVE'
           AND dac.expires_at > NOW()
           AND v.is_active = TRUE
           AND v.verification_status = 'approved'
           AND v.driver_profile_id IS NULL`,
      [code],
    );

    return result.rows[0] ?? null;
  }

  async claimAssignmentCode(
    code: string,
    driverUserId: string,
    driverProfileId: string,
  ): Promise<{
    vehicleId: string;
    make: string;
    model: string;
    plateNumber: string;
  }> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      /*
       * Lock the assignment code first so two drivers cannot
       * successfully claim the same code concurrently.
       */
      const codeResult = await client.query<{
        vehicleId: string;
        fleetOwnerId: string;
        status: string;
        expiresAt: Date;
      }>(
        `SELECT
           vehicle_id AS "vehicleId",
           fleet_owner_id AS "fleetOwnerId",
           status,
           expires_at AS "expiresAt"
         FROM driver_assignment_codes
         WHERE code = $1
         FOR UPDATE`,
        [code],
      );

      const assignmentCode = codeResult.rows[0];

      if (
        !assignmentCode ||
        assignmentCode.status !== 'ACTIVE' ||
        assignmentCode.expiresAt <= new Date()
      ) {
        throw new Error('ASSIGNMENT_CODE_INVALID');
      }

      /*
       * The supplied driver profile must belong to the authenticated
       * driver user and the driver must be approved.
       */
      const driverResult = await client.query<{
        id: string;
        userId: string;
      }>(
        `SELECT
           id,
           user_id AS "userId"
         FROM driver_profiles
         WHERE id = $1
           AND user_id = $2
           AND verification_status = 'approved'
         FOR UPDATE`,
        [driverProfileId, driverUserId],
      );

      const driver = driverResult.rows[0];

      if (!driver) {
        throw new Error('ASSIGNMENT_CODE_INVALID');
      }

      /*
       * The driver must belong to the fleet owner's partner.
       *
       * partner_drivers is the canonical Partner/Fleet -> Driver
       * relationship for fleet-managed drivers.
       */
      const membershipResult = await client.query<{
        partnerId: string;
      }>(
        `SELECT
           p.id AS "partnerId"
         FROM partners p
         JOIN partner_drivers pd
           ON pd.partner_id = p.id
         WHERE p.user_id = $1
           AND pd.driver_profile_id = $2
           AND pd.status = 'ACTIVE'
         LIMIT 1`,
        [assignmentCode.fleetOwnerId, driverProfileId],
      );

      if (!membershipResult.rows[0]) {
        throw new Error('ASSIGNMENT_CODE_INVALID');
      }

      /*
       * Lock the vehicle and validate the complete operational state.
       *
       * A fleet owner cannot assign:
       * - another owner's vehicle
       * - inactive vehicle
       * - unverified vehicle
       * - already assigned vehicle
       */
      const vehicleResult = await client.query<{
        id: string;
        make: string;
        model: string;
        plateNumber: string;
      }>(
        `SELECT
             id,
             make,
             model,
             plate_number AS "plateNumber"
           FROM vehicles
           WHERE id = $1
             AND owner_id = $2
             AND is_active = TRUE
             AND verification_status = 'approved'
             AND driver_profile_id IS NULL
           FOR UPDATE`,
        [assignmentCode.vehicleId, assignmentCode.fleetOwnerId],
      );

      const vehicle = vehicleResult.rows[0];

      if (!vehicle) {
        throw new Error('ASSIGNMENT_CODE_INVALID');
      }

      /*
       * Defensive consistency check:
       * if the driver currently points to another vehicle, clear that
       * pointer before assigning the new vehicle.
       *
       * The vehicle-side relationship is only changed for the new
       * vehicle, so the two sides remain consistent.
       */
      await client.query(
        `UPDATE vehicles
         SET driver_profile_id = NULL,
             updated_at = NOW()
         WHERE driver_profile_id = $1
           AND id <> $2`,
        [driverProfileId, assignmentCode.vehicleId],
      );

      await client.query(
        `UPDATE driver_profiles
         SET active_vehicle_id = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [assignmentCode.vehicleId, driverProfileId],
      );

      await client.query(
        `UPDATE vehicles
         SET driver_profile_id = $1,
             updated_at = NOW()
         WHERE id = $2
           AND owner_id = $3
           AND is_active = TRUE
           AND verification_status = 'approved'`,
        [driverProfileId, assignmentCode.vehicleId, assignmentCode.fleetOwnerId],
      );

      await client.query(
        `UPDATE driver_assignment_codes
         SET driver_id = $1,
             status = 'CLAIMED',
             updated_at = NOW()
         WHERE code = $2
           AND status = 'ACTIVE'`,
        [driverUserId, code],
      );

      await client.query('COMMIT');

      return {
        vehicleId: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        plateNumber: vehicle.plateNumber,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve original error.
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async setActiveVehicle(driverProfileId: string, vehicleId: string): Promise<boolean> {
    /*
     * A driver can only select a vehicle that is:
     * - actually assigned to this driver
     * - active
     * - approved
     *
     * This prevents a driver from pointing active_vehicle_id at an
     * arbitrary vehicle UUID.
     */
    const result = await this.pool.query(
      `UPDATE driver_profiles dp
       SET active_vehicle_id = v.id,
           updated_at = NOW()
       FROM vehicles v
       WHERE dp.id = $1
         AND v.id = $2
         AND v.driver_profile_id = dp.id
         AND v.is_active = TRUE
         AND v.verification_status = 'approved'
       RETURNING dp.id`,
      [driverProfileId, vehicleId],
    );

    return result.rowCount === 1;
  }

  async getAssignedVehicle(driverProfileId: string): Promise<{
    id: string;
    make: string;
    model: string;
    plateNumber: string;
    color: string | null;
    sector: string;
    category: string;
  } | null> {
    const result = await this.pool.query<{
      id: string;
      make: string;
      model: string;
      plateNumber: string;
      color: string | null;
      sector: string;
      category: string;
    }>(
      `SELECT
         v.id,
         v.make,
         v.model,
         v.plate_number AS "plateNumber",
         v.color,
         v.sector,
         v.category
       FROM vehicles v
       JOIN driver_profiles dp
         ON dp.active_vehicle_id = v.id
        AND v.driver_profile_id = dp.id
       WHERE dp.id = $1
         AND v.is_active = TRUE
         AND v.verification_status = 'approved'
       LIMIT 1`,
      [driverProfileId],
    );

    return result.rows[0] ?? null;
  }
}
