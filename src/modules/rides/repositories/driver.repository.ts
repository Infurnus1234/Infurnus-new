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
  upsertProfile(userId: string, input: UpsertDriverProfileInput): Promise<DriverProfile>;
  getAvailability(profileId: string): Promise<DriverAvailabilityStatus | null>;
  updateAvailability(profileId: string, status: DriverAvailabilityStatus): Promise<boolean>;
  setBusy(profileId: string, client?: PoolClient): Promise<boolean>;
  releaseBusy(profileId: string, client?: PoolClient): Promise<boolean>;
  updateLocation(profileId: string, location: DriverLocation): Promise<boolean>;
  markStale(profileId: string): Promise<boolean>;
  findActiveVehicleByUserId?(userId: string): Promise<{ sector: string; category: string } | null>;
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
  ): Promise<{ vehicleId: string; make: string; model: string; plateNumber: string }>;
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
  id, user_id AS "userId", license_number AS "licenseNumber",
  license_expiry::text AS "licenseExpiry", license_document_key AS "licenseDocumentKey",
  vehicle_rc_document_key AS "vehicleRcDocumentKey", profile_photo_key AS "profilePhotoKey",
  verification_status AS "verificationStatus", rejection_reason AS "rejectionReason",
  availability_status AS "availabilityStatus",
  dob::text AS "dob", gender, address, city, state, pin_code AS "pinCode",
  emergency_contact_name AS "emergencyContactName",
  emergency_contact_phone AS "emergencyContactPhone",
  active_vehicle_id AS "activeVehicleId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

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
      `SELECT ${driverProjection} FROM driver_profiles WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async upsertProfile(userId: string, input: UpsertDriverProfileInput): Promise<DriverProfile> {
    const result = await this.pool.query<DriverProfile>(
      `INSERT INTO driver_profiles (
         user_id, license_number, license_expiry, profile_photo_key, license_document_key, vehicle_rc_document_key,
         dob, gender, address, city, state, pin_code, emergency_contact_name, emergency_contact_phone
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (user_id) DO UPDATE
       SET license_number = EXCLUDED.license_number,
           license_expiry = EXCLUDED.license_expiry,
           profile_photo_key = COALESCE(EXCLUDED.profile_photo_key, driver_profiles.profile_photo_key),
           license_document_key = COALESCE(EXCLUDED.license_document_key, driver_profiles.license_document_key),
           vehicle_rc_document_key = COALESCE(EXCLUDED.vehicle_rc_document_key, driver_profiles.vehicle_rc_document_key),
           dob = COALESCE(EXCLUDED.dob, driver_profiles.dob),
           gender = COALESCE(EXCLUDED.gender, driver_profiles.gender),
           address = COALESCE(EXCLUDED.address, driver_profiles.address),
           city = COALESCE(EXCLUDED.city, driver_profiles.city),
           state = COALESCE(EXCLUDED.state, driver_profiles.state),
           pin_code = COALESCE(EXCLUDED.pin_code, driver_profiles.pin_code),
           emergency_contact_name = COALESCE(EXCLUDED.emergency_contact_name, driver_profiles.emergency_contact_name),
           emergency_contact_phone = COALESCE(EXCLUDED.emergency_contact_phone, driver_profiles.emergency_contact_phone),
           updated_at = NOW()
       RETURNING ${driverProjection}`,
      [
        userId,
        input.licenseNumber,
        input.licenseExpiry,
        input.profilePhotoKey ?? null,
        input.licenseDocumentKey ?? null,
        input.vehicleRcDocumentKey ?? null,
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

  async findActiveVehicleByUserId(
    userId: string,
  ): Promise<{ sector: string; category: string } | null> {
    const result = await this.pool.query<{ sector: string; category: string }>(
      `SELECT COALESCE(v.sector, 'passenger') AS "sector", COALESCE(v.category, 'sedan') AS "category"
       FROM driver_profiles dp
       JOIN vehicles v ON v.id = COALESCE(
         dp.active_vehicle_id,
         (SELECT id FROM vehicles v2 WHERE v2.driver_profile_id = dp.id AND v2.is_active = TRUE ORDER BY v2.created_at DESC LIMIT 1)
       )
       WHERE dp.user_id = $1 AND v.is_active = TRUE
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
    const result = await this.pool.query<DriverCandidate>(
      `SELECT dp.id AS "driverProfileId", dp.user_id AS "userId", v.id AS "vehicleId",
          ST_Distance(dp.last_location, pickup.point) AS "distanceMeters",
          ST_Y(dp.last_location::geometry) AS latitude,
          ST_X(dp.last_location::geometry) AS longitude,
          dp.availability_status AS "availabilityStatus",
          dp.verification_status AS "verificationStatus",
          dp.last_location_at AS "locationRecordedAt",
          COUNT(active_ride.id)::int AS "activeRideCount",
          v.sector AS "sector",
          v.category AS "vehicleCategory"
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id AND u.status = 'active'
       JOIN vehicles v ON v.id = COALESCE(
         dp.active_vehicle_id,
         (SELECT id FROM vehicles v2 WHERE v2.driver_profile_id = dp.id AND v2.is_active = TRUE ORDER BY v2.created_at DESC LIMIT 1)
       ) AND v.is_active = TRUE
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
         AND ($6::varchar IS NULL OR v.sector = $6)
         AND ($7::varchar IS NULL OR v.category = $7)
       GROUP BY dp.id, dp.user_id, v.id, pickup.point, v.sector, v.category
       ORDER BY ST_Distance(dp.last_location, pickup.point), dp.id
       LIMIT $4`,
      [
        longitude,
        latitude,
        radiusMeters,
        limit,
        staleBefore,
        sector ?? null,
        vehicleCategory ?? null,
      ],
    );
    return result.rows;
  }

  async verifyAssignmentCode(code: string): Promise<AssignmentCodePreview | null> {
    const result = await this.pool.query<{
      code: string;
      vehicleId: string;
      make: string;
      model: string;
      plateNumber: string;
      color: string | null;
      sector: string;
      category: string;
      ownerId: string;
      ownerName: string;
      businessName: string | null;
    }>(
      `SELECT c.code, v.id AS "vehicleId", v.make, v.model, v.plate_number AS "plateNumber",
              v.color, COALESCE(v.sector, 'passenger') AS "sector", COALESCE(v.category, 'sedan') AS "category",
              u.id AS "ownerId", (u.first_name || ' ' || u.last_name) AS "ownerName",
              p.business_name AS "businessName"
       FROM driver_assignment_codes c
       JOIN vehicles v ON v.id = c.vehicle_id
       JOIN users u ON u.id = c.fleet_owner_id
       LEFT JOIN partners p ON p.user_id = u.id
       WHERE c.code = $1 AND c.status = 'ACTIVE' AND c.expires_at > NOW()`,
      [code],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      code: row.code,
      vehicle: {
        id: row.vehicleId,
        make: row.make,
        model: row.model,
        plateNumber: row.plateNumber,
        color: row.color,
        sector: row.sector,
        category: row.category,
      },
      owner: {
        id: row.ownerId,
        name: row.ownerName,
        businessName: row.businessName,
      },
    };
  }

  async claimAssignmentCode(
    code: string,
    driverUserId: string,
    driverProfileId: string,
  ): Promise<{ vehicleId: string; make: string; model: string; plateNumber: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const codeRes = await client.query<{ id: string; vehicle_id: string }>(
        `SELECT id, vehicle_id FROM driver_assignment_codes
         WHERE code = $1 AND status = 'ACTIVE' AND expires_at > NOW()
         FOR UPDATE`,
        [code],
      );

      const assignmentCode = codeRes.rows[0];
      if (!assignmentCode) {
        throw new Error('ASSIGNMENT_CODE_INVALID');
      }

      await client.query(
        `UPDATE driver_assignment_codes
         SET status = 'CLAIMED', driver_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [driverUserId, assignmentCode.id],
      );

      const vehicleRes = await client.query<{
        id: string;
        make: string;
        model: string;
        plate_number: string;
      }>(
        `UPDATE vehicles
         SET driver_profile_id = $1, is_active = TRUE, updated_at = NOW()
         WHERE id = $2
         RETURNING id, make, model, plate_number`,
        [driverProfileId, assignmentCode.vehicle_id],
      );

      await client.query(
        `UPDATE driver_profiles
         SET active_vehicle_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [assignmentCode.vehicle_id, driverProfileId],
      );

      await client.query('COMMIT');

      const v = vehicleRes.rows[0];
      if (!v) throw new Error('Vehicle assignment failed');
      return {
        vehicleId: v.id,
        make: v.make,
        model: v.model,
        plateNumber: v.plate_number,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setActiveVehicle(driverProfileId: string, vehicleId: string): Promise<boolean> {
    const checkRes = await this.pool.query(
      `SELECT 1 FROM vehicles WHERE id = $1 AND driver_profile_id = $2 AND is_active = TRUE`,
      [vehicleId, driverProfileId],
    );
    if (checkRes.rowCount !== 1) return false;

    const result = await this.pool.query(
      `UPDATE driver_profiles SET active_vehicle_id = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id`,
      [vehicleId, driverProfileId],
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
      `SELECT v.id, v.make, v.model, v.plate_number AS "plateNumber",
              v.color, COALESCE(v.sector, 'passenger') AS "sector", COALESCE(v.category, 'sedan') AS "category"
       FROM driver_profiles dp
       JOIN vehicles v ON v.id = COALESCE(
         dp.active_vehicle_id,
         (SELECT id FROM vehicles v2 WHERE v2.driver_profile_id = dp.id AND v2.is_active = TRUE ORDER BY v2.created_at DESC LIMIT 1)
       )
       WHERE dp.id = $1 AND v.is_active = TRUE
       LIMIT 1`,
      [driverProfileId],
    );
    return result.rows[0] ?? null;
  }
}
