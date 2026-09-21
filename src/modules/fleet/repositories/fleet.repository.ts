import type { Pool } from 'pg';
import type { CreateFleetVehicleInput, UpdateFleetVehicleInput } from '../schemas/fleet.schemas.js';
import type {
  FleetDashboardMetrics,
  FleetDriver,
  FleetEarningsSummary,
  FleetTrip,
  FleetVehicle,
} from '../types/fleet.js';

export interface FleetRepository {
  getDashboard(ownerId: string): Promise<FleetDashboardMetrics>;
  listVehicles(ownerId: string): Promise<FleetVehicle[]>;
  createVehicle(ownerId: string, input: CreateFleetVehicleInput): Promise<FleetVehicle>;
  updateVehicle(
    ownerId: string,
    vehicleId: string,
    input: UpdateFleetVehicleInput,
  ): Promise<FleetVehicle | null>;
  deactivateVehicle(ownerId: string, vehicleId: string): Promise<boolean>;
  generateAssignmentCode(
    ownerId: string,
    vehicleId: string,
  ): Promise<{ code: string; expiresAt: Date }>;
  unassignDriver(ownerId: string, vehicleId: string): Promise<boolean>;
  listDrivers(ownerId: string): Promise<FleetDriver[]>;
  listTrips(ownerId: string, limit?: number): Promise<FleetTrip[]>;
  getEarnings(ownerId: string): Promise<FleetEarningsSummary>;
}

export class PostgresFleetRepository implements FleetRepository {
  constructor(private readonly pool: Pool) {}

  async getDashboard(ownerId: string): Promise<FleetDashboardMetrics> {
    const vehiclesRes = await this.pool.query<{
      totalVehicles: string;
      activeVehicles: string;
      maintenanceVehicles: string;
      availableVehicles: string;
    }>(
      `SELECT
         COUNT(*)::text AS "totalVehicles",
         COUNT(*) FILTER (WHERE v.is_active = TRUE)::text AS "activeVehicles",
         COUNT(*) FILTER (WHERE v.is_active = FALSE)::text AS "maintenanceVehicles",
         COUNT(*) FILTER (WHERE v.is_active = TRUE AND dp.availability_status = 'available')::text AS "availableVehicles"
       FROM vehicles v
       LEFT JOIN driver_profiles dp ON dp.id = v.driver_profile_id
       WHERE v.owner_id = $1`,
      [ownerId],
    );

    const driversRes = await this.pool.query<{
      totalDrivers: string;
      availableDrivers: string;
    }>(
      `SELECT
         COUNT(DISTINCT v.driver_profile_id)::text AS "totalDrivers",
         COUNT(DISTINCT v.driver_profile_id) FILTER (WHERE dp.availability_status = 'available')::text AS "availableDrivers"
       FROM vehicles v
       JOIN driver_profiles dp ON dp.id = v.driver_profile_id
       WHERE v.owner_id = $1 AND v.driver_profile_id IS NOT NULL`,
      [ownerId],
    );

    const tripsRes = await this.pool.query<{
      activeTrips: string;
      todayRevenue: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress'))::text AS "activeTrips",
         COALESCE(SUM(COALESCE(r.final_fare, r.fare_estimate, 0)) FILTER (
           WHERE r.status = 'completed' AND r.completed_at >= CURRENT_DATE
         ), 0)::text AS "todayRevenue"
       FROM rides r
       JOIN vehicles v ON v.id = r.assigned_vehicle_id
       WHERE v.owner_id = $1`,
      [ownerId],
    );

    const docsRes = await this.pool.query<{ pendingDocs: string }>(
      `SELECT COUNT(*)::text AS "pendingDocs"
       FROM partner_documents pd
       JOIN partners p ON p.id = pd.partner_id
       WHERE p.user_id = $1 AND pd.status IN ('PENDING', 'SUBMITTED')`,
      [ownerId],
    );

    const vRow = vehiclesRes.rows[0];
    const dRow = driversRes.rows[0];
    const tRow = tripsRes.rows[0];
    const docRow = docsRes.rows[0];

    return {
      totalVehicles: parseInt(vRow?.totalVehicles ?? '0', 10),
      activeVehicles: parseInt(vRow?.activeVehicles ?? '0', 10),
      availableVehicles: parseInt(vRow?.availableVehicles ?? '0', 10),
      maintenanceVehicles: parseInt(vRow?.maintenanceVehicles ?? '0', 10),
      totalDrivers: parseInt(dRow?.totalDrivers ?? '0', 10),
      availableDrivers: parseInt(dRow?.availableDrivers ?? '0', 10),
      pendingDocuments: parseInt(docRow?.pendingDocs ?? '0', 10),
      activeTrips: parseInt(tRow?.activeTrips ?? '0', 10),
      todayRevenue: parseFloat(tRow?.todayRevenue ?? '0'),
    };
  }

  async listVehicles(ownerId: string): Promise<FleetVehicle[]> {
    const result = await this.pool.query<{
      id: string;
      ownerId: string;
      driverProfileId: string | null;
      make: string;
      model: string;
      color: string | null;
      plateNumber: string;
      sector: string;
      category: string;
      fuelRatePerKm: string;
      loadCapacityKg: string;
      year: number | null;
      fuelType: string | null;
      seatingCapacity: number | null;
      registrationDate: string | null;
      registrationExpiry: string | null;
      isCommercial: boolean;
      permitDetails: string | null;
      verificationStatus: string;
      isActive: boolean;
      driverUserId: string | null;
      driverName: string | null;
      driverPhone: string | null;
      driverAvailability: string | null;
      activeCode: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>(
      `SELECT
         v.id, v.owner_id AS "ownerId", v.driver_profile_id AS "driverProfileId",
         v.make, v.model, v.color, v.plate_number AS "plateNumber",
         COALESCE(v.sector, 'passenger') AS "sector",
         COALESCE(v.category, 'sedan') AS "category",
         COALESCE(v.fuel_rate_per_km, 0)::text AS "fuelRatePerKm",
         COALESCE(v.load_capacity_kg, 0)::text AS "loadCapacityKg",
         v.manufacturing_year AS "year", v.fuel_type AS "fuelType",
         v.seating_capacity AS "seatingCapacity",
         v.registration_date::text AS "registrationDate",
         v.registration_expiry::text AS "registrationExpiry",
         COALESCE(v.is_commercial, TRUE) AS "isCommercial",
         v.permit_details AS "permitDetails",
         COALESCE(v.verification_status, 'approved') AS "verificationStatus",
         v.is_active AS "isActive",
         u.id AS "driverUserId",
         CASE WHEN u.id IS NOT NULL THEN (u.first_name || ' ' || u.last_name) ELSE NULL END AS "driverName",
         u.phone AS "driverPhone",
         dp.availability_status AS "driverAvailability",
         ac.code AS "activeCode",
         v.created_at AS "createdAt",
         v.updated_at AS "updatedAt"
       FROM vehicles v
       LEFT JOIN driver_profiles dp ON dp.id = v.driver_profile_id
       LEFT JOIN users u ON u.id = dp.user_id
       LEFT JOIN LATERAL (
         SELECT code FROM driver_assignment_codes
         WHERE vehicle_id = v.id AND status = 'ACTIVE' AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1
       ) ac ON TRUE
       WHERE v.owner_id = $1
       ORDER BY v.created_at DESC`,
      [ownerId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      driverProfileId: row.driverProfileId,
      make: row.make,
      model: row.model,
      color: row.color,
      plateNumber: row.plateNumber,
      sector: row.sector,
      category: row.category,
      fuelRatePerKm: parseFloat(row.fuelRatePerKm),
      loadCapacityKg: parseFloat(row.loadCapacityKg),
      year: row.year,
      fuelType: row.fuelType,
      seatingCapacity: row.seatingCapacity,
      registrationDate: row.registrationDate,
      registrationExpiry: row.registrationExpiry,
      isCommercial: row.isCommercial,
      permitDetails: row.permitDetails,
      verificationStatus: row.verificationStatus,
      isActive: row.isActive,
      assignedDriver:
        row.driverProfileId && row.driverUserId
          ? {
              id: row.driverProfileId,
              userId: row.driverUserId,
              name: row.driverName ?? 'Driver',
              phone: row.driverPhone ?? '',
              availabilityStatus: row.driverAvailability,
            }
          : null,
      activeAssignmentCode: row.activeCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async createVehicle(ownerId: string, input: CreateFleetVehicleInput): Promise<FleetVehicle> {
    const result = await this.pool.query<FleetVehicle>(
      `INSERT INTO vehicles (
         owner_id, make, model, color, plate_number, sector, category,
         fuel_rate_per_km, load_capacity_kg, manufacturing_year, fuel_type,
         seating_capacity, registration_date, registration_expiry, is_commercial,
         permit_details, verification_status, is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'approved', TRUE)
       RETURNING
         id, owner_id AS "ownerId", driver_profile_id AS "driverProfileId",
         make, model, color, plate_number AS "plateNumber",
         sector, category,
         COALESCE(fuel_rate_per_km, 0)::numeric AS "fuelRatePerKm",
         COALESCE(load_capacity_kg, 0)::numeric AS "loadCapacityKg",
         manufacturing_year AS "year", fuel_type AS "fuelType",
         seating_capacity AS "seatingCapacity",
         registration_date::text AS "registrationDate",
         registration_expiry::text AS "registrationExpiry",
         is_commercial AS "isCommercial",
         permit_details AS "permitDetails",
         verification_status AS "verificationStatus",
         is_active AS "isActive",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        ownerId,
        input.make,
        input.model,
        input.color ?? null,
        input.plateNumber,
        input.sector,
        input.category,
        input.fuelRatePerKm,
        input.loadCapacityKg,
        input.year ?? null,
        input.fuelType ?? null,
        input.seatingCapacity ?? null,
        input.registrationDate ?? null,
        input.registrationExpiry ?? null,
        input.isCommercial,
        input.permitDetails ?? null,
      ],
    );

    const vehicle = result.rows[0];
    if (!vehicle) throw new Error('Failed to create fleet vehicle');
    return vehicle;
  }

  async updateVehicle(
    ownerId: string,
    vehicleId: string,
    input: UpdateFleetVehicleInput,
  ): Promise<FleetVehicle | null> {
    const columns: Record<string, string> = {
      make: 'make',
      model: 'model',
      color: 'color',
      plateNumber: 'plate_number',
      sector: 'sector',
      category: 'category',
      fuelRatePerKm: 'fuel_rate_per_km',
      loadCapacityKg: 'load_capacity_kg',
      year: 'manufacturing_year',
      fuelType: 'fuel_type',
      seatingCapacity: 'seating_capacity',
      registrationDate: 'registration_date',
      registrationExpiry: 'registration_expiry',
      isCommercial: 'is_commercial',
      permitDetails: 'permit_details',
    };

    const fields = Object.keys(input) as (keyof UpdateFleetVehicleInput)[];
    if (fields.length === 0) return null;

    const values = fields.map((f) => (input[f] === undefined ? null : input[f]));
    const assignments = fields.map((f, i) => `${columns[f]} = $${i + 1}`);

    const result = await this.pool.query<FleetVehicle>(
      `UPDATE vehicles SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length + 1} AND owner_id = $${values.length + 2}
       RETURNING id, owner_id AS "ownerId", driver_profile_id AS "driverProfileId",
                 make, model, color, plate_number AS "plateNumber",
                 sector, category, is_active AS "isActive",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [...values, vehicleId, ownerId],
    );

    return result.rows[0] ?? null;
  }

  async deactivateVehicle(ownerId: string, vehicleId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE vehicles SET is_active = FALSE, retired_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND owner_id = $2 AND is_active = TRUE
       RETURNING id`,
      [vehicleId, ownerId],
    );
    return result.rowCount === 1;
  }

  async generateAssignmentCode(
    ownerId: string,
    vehicleId: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    // Check vehicle belongs to owner
    const check = await this.pool.query(`SELECT id FROM vehicles WHERE id = $1 AND owner_id = $2`, [
      vehicleId,
      ownerId,
    ]);
    if (check.rowCount !== 1) {
      throw new Error('VEHICLE_NOT_FOUND');
    }

    // Revoke any previous active code
    await this.pool.query(
      `UPDATE driver_assignment_codes SET status = 'REVOKED', updated_at = NOW()
       WHERE vehicle_id = $1 AND status = 'ACTIVE'`,
      [vehicleId],
    );

    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const code = `FLEET-${randomSuffix}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await this.pool.query(
      `INSERT INTO driver_assignment_codes (code, vehicle_id, fleet_owner_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [code, vehicleId, ownerId, expiresAt],
    );

    return { code, expiresAt };
  }

  async unassignDriver(ownerId: string, vehicleId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const vRes = await client.query<{ driver_profile_id: string | null }>(
        `SELECT driver_profile_id FROM vehicles
         WHERE id = $1 AND owner_id = $2
         FOR UPDATE`,
        [vehicleId, ownerId],
      );

      const v = vRes.rows[0];
      if (!v) {
        throw new Error('VEHICLE_NOT_FOUND');
      }

      if (v.driver_profile_id) {
        await client.query(
          `UPDATE driver_profiles SET active_vehicle_id = NULL, updated_at = NOW()
           WHERE id = $1 AND active_vehicle_id = $2`,
          [v.driver_profile_id, vehicleId],
        );
      }

      await client.query(
        `UPDATE vehicles SET driver_profile_id = NULL, updated_at = NOW()
         WHERE id = $1`,
        [vehicleId],
      );

      await client.query(
        `UPDATE driver_assignment_codes SET status = 'REVOKED', updated_at = NOW()
         WHERE vehicle_id = $1 AND status = 'ACTIVE'`,
        [vehicleId],
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listDrivers(ownerId: string): Promise<FleetDriver[]> {
    const result = await this.pool.query<{
      id: string;
      userId: string;
      name: string;
      phone: string;
      email: string | null;
      licenseNumber: string;
      licenseExpiry: string;
      verificationStatus: string;
      availabilityStatus: string | null;
      vehicleId: string | null;
      vehicleMake: string | null;
      vehicleModel: string | null;
      vehiclePlate: string | null;
      completedTrips: string;
      totalEarnings: string;
    }>(
      `SELECT
         dp.id, dp.user_id AS "userId",
         (u.first_name || ' ' || u.last_name) AS "name",
         u.phone, u.email,
         dp.license_number AS "licenseNumber",
         dp.license_expiry::text AS "licenseExpiry",
         dp.verification_status AS "verificationStatus",
         dp.availability_status AS "availabilityStatus",
         v.id AS "vehicleId", v.make AS "vehicleMake", v.model AS "vehicleModel", v.plate_number AS "vehiclePlate",
         COUNT(r.id)::text AS "completedTrips",
         COALESCE(SUM(COALESCE(r.final_fare, r.fare_estimate, 0)), 0)::text AS "totalEarnings"
       FROM vehicles v
       JOIN driver_profiles dp ON dp.id = v.driver_profile_id
       JOIN users u ON u.id = dp.user_id
       LEFT JOIN rides r ON r.assigned_vehicle_id = v.id AND r.status = 'completed'
       WHERE v.owner_id = $1
       GROUP BY dp.id, u.id, dp.user_id, u.first_name, u.last_name, u.phone, u.email,
                dp.license_number, dp.license_expiry, dp.verification_status, dp.availability_status,
                v.id, v.make, v.model, v.plate_number
       ORDER BY u.first_name ASC`,
      [ownerId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      licenseNumber: row.licenseNumber,
      licenseExpiry: row.licenseExpiry,
      verificationStatus: row.verificationStatus,
      availabilityStatus: row.availabilityStatus,
      assignedVehicle: row.vehicleId
        ? {
            id: row.vehicleId,
            make: row.vehicleMake ?? '',
            model: row.vehicleModel ?? '',
            plateNumber: row.vehiclePlate ?? '',
          }
        : null,
      completedTrips: parseInt(row.completedTrips, 10),
      totalEarnings: parseFloat(row.totalEarnings),
    }));
  }

  async listTrips(ownerId: string, limit = 50): Promise<FleetTrip[]> {
    const result = await this.pool.query<{
      id: string;
      vehicleId: string;
      vehiclePlate: string;
      driverName: string | null;
      pickupAddress: string | null;
      destinationAddress: string | null;
      status: string;
      fareEstimate: string | null;
      finalFare: string | null;
      actualDistanceMeters: number | null;
      createdAt: Date;
      completedAt: Date | null;
    }>(
      `SELECT
         r.id, v.id AS "vehicleId", v.plate_number AS "vehiclePlate",
         (u.first_name || ' ' || u.last_name) AS "driverName",
         r.pickup_address AS "pickupAddress",
         r.destination_address AS "destinationAddress",
         r.status,
         r.fare_estimate::text AS "fareEstimate",
         r.final_fare::text AS "finalFare",
         r.actual_distance_meters AS "actualDistanceMeters",
         r.created_at AS "createdAt",
         r.completed_at AS "completedAt"
       FROM rides r
       JOIN vehicles v ON v.id = r.assigned_vehicle_id
       LEFT JOIN driver_profiles dp ON dp.id = r.assigned_driver_id
       LEFT JOIN users u ON u.id = dp.user_id
       WHERE v.owner_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2`,
      [ownerId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      vehiclePlate: row.vehiclePlate,
      driverName: row.driverName,
      pickupAddress: row.pickupAddress,
      destinationAddress: row.destinationAddress,
      status: row.status,
      fareEstimate: row.fareEstimate ? parseFloat(row.fareEstimate) : null,
      finalFare: row.finalFare ? parseFloat(row.finalFare) : null,
      actualDistanceMeters: row.actualDistanceMeters,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }));
  }

  async getEarnings(ownerId: string): Promise<FleetEarningsSummary> {
    const result = await this.pool.query<{
      todayRevenue: string;
      thisWeekRevenue: string;
      thisMonthRevenue: string;
      totalTrips: string;
    }>(
      `SELECT
         COALESCE(SUM(COALESCE(r.final_fare, r.fare_estimate, 0)) FILTER (
           WHERE r.status = 'completed' AND r.completed_at >= CURRENT_DATE
         ), 0)::text AS "todayRevenue",
         COALESCE(SUM(COALESCE(r.final_fare, r.fare_estimate, 0)) FILTER (
           WHERE r.status = 'completed' AND r.completed_at >= date_trunc('week', CURRENT_DATE)
         ), 0)::text AS "thisWeekRevenue",
         COALESCE(SUM(COALESCE(r.final_fare, r.fare_estimate, 0)) FILTER (
           WHERE r.status = 'completed' AND r.completed_at >= date_trunc('month', CURRENT_DATE)
         ), 0)::text AS "thisMonthRevenue",
         COUNT(r.id) FILTER (WHERE r.status = 'completed')::text AS "totalTrips"
       FROM rides r
       JOIN vehicles v ON v.id = r.assigned_vehicle_id
       WHERE v.owner_id = $1`,
      [ownerId],
    );

    const row = result.rows[0];
    const thisMonthRevenue = parseFloat(row?.thisMonthRevenue ?? '0');
    const commission = thisMonthRevenue * 0.1; // 10% platform commission standard

    return {
      todayRevenue: parseFloat(row?.todayRevenue ?? '0'),
      thisWeekRevenue: parseFloat(row?.thisWeekRevenue ?? '0'),
      thisMonthRevenue,
      totalTrips: parseInt(row?.totalTrips ?? '0', 10),
      platformCommission: commission,
      netPayout: thisMonthRevenue - commission,
    };
  }
}
