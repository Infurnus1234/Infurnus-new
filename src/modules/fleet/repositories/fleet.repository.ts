import {
  validateOperatingLocation,
  requirePremiumOperatingLocation,
} from '../../maps/vehicle-operating-location.js';
import type { VehicleType } from '../../vehicles/types/vehicle.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { assignFirstOwnerVehicle } from '../../providers/repositories/default-owner-vehicle.js';
import { premiumCityAreas } from '../../maps/premium-city-areas.js';
import { paidRideRevenueSql } from './fleet-revenue.repository.js';
import { env } from '../../../config/env.js';
import { FleetRevenueRepository, type RevenueFilter } from './fleet-revenue.repository.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { FleetListQuery } from '../schemas/fleet.schemas.js';
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
  revenue(ownerId: string, filter?: RevenueFilter): ReturnType<FleetRevenueRepository['report']>;
  catalog(ownerId?: string): Promise<{ sectors: string[]; types: Record<string, unknown>[] }>;

  listVehicles(ownerId: string, query?: FleetListQuery): Promise<FleetVehicle[]>;

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
    driverProfileId?: string,
  ): Promise<{ code: string; expiresAt: Date; permanent?: boolean }>;

  unassignDriver(ownerId: string, vehicleId: string): Promise<boolean>;

  listDrivers(ownerId: string, query?: FleetListQuery): Promise<FleetDriver[]>;

  listTrips(ownerId: string, limit?: number): Promise<FleetTrip[]>;

  getEarnings(ownerId: string): Promise<FleetEarningsSummary>;
}

export interface AllowedVehicleType {
  sector: string;
  code: string;
  name: string;
}

export const ALLOWED_VEHICLE_TYPES: AllowedVehicleType[] = [
  { sector: 'passenger', code: 'mini', name: 'Mini Cab' },
  { sector: 'passenger', code: 'sedan', name: 'Sedan' },
  { sector: 'passenger', code: 'suv', name: 'SUV' },
  { sector: 'logistics', code: 'cargo_207_heavy', name: '207 Heavy' },
  { sector: 'logistics', code: 'three_wheeler', name: '3-Wheeler (Goods)' },
  { sector: 'logistics', code: 'mini_truck', name: 'Mini Truck (Tata Ace)' },
  { sector: 'logistics', code: 'tata_407', name: 'Tata 407' },
  { sector: 'service', code: 'ambulance', name: 'Ambulance' },
  { sector: 'premium', code: 'thar', name: 'Mahindra Thar' },
];

export class PostgresFleetRepository implements FleetRepository {
  constructor(private readonly pool: Pool) {}

  async catalog(_ownerId?: string) {
    const repository = new PostgresVehicleRepository(this.pool);
    const sectors = ['rental', 'logistics', 'premium', 'service'] as const;
    const pages = await Promise.all(
      sectors.map(async (sector) => {
        const types: VehicleType[] = [];
        let offset = 0;
        for (;;) {
          const page = await repository.listTypes(
            100,
            offset,
            sector === 'rental' ? 'passenger' : sector,
            false,
            undefined,
            true,
            true,
          );
          types.push(...page);
          if (page.length < 100) return types;
          offset += page.length;
        }
      }),
    );
    return {
      selectionCatalogVersion: 2,
      // Rental bookings retain their existing passenger inventory identifiers.
      sectors: ['passenger', 'logistics', 'premium', 'service'],
      types: pages
        .flat()
        .map(({ fixedHourlyPricing: _pricing, rentalPricingVersion: _rentalVersion, ...type }) => ({
          ...type,
          sector: type.sector === 'rental' ? 'passenger' : type.sector,
        })),
      operatingCities: premiumCityAreas.cities.map(({ id, name }) => ({ id, name })),
    };
  }
  async revenue(ownerId: string, filter: RevenueFilter = {}) {
    return new FleetRevenueRepository(this.pool).report(ownerId, filter);
  }
  async getDashboard(ownerId: string): Promise<FleetDashboardMetrics> {
    const vehiclesRes = await this.pool.query<{
      totalVehicles: string;
      activeVehicles: string;
      maintenanceVehicles: string;
      availableVehicles: string;
    }>(
      `SELECT
         COUNT(*)::text AS "totalVehicles",
         COUNT(*) FILTER (
           WHERE v.is_active = TRUE
         )::text AS "activeVehicles",
         COUNT(*) FILTER (
           WHERE v.is_active = FALSE
         )::text AS "maintenanceVehicles",
         COUNT(*) FILTER (
           WHERE v.is_active = TRUE
             AND dp.availability_status = 'available'
         )::text AS "availableVehicles"
       FROM vehicles v
       LEFT JOIN driver_profiles dp
         ON dp.id = v.driver_profile_id
       WHERE v.owner_id = $1`,
      [ownerId],
    );

    const driversRes = await this.pool.query<{
      totalDrivers: string;
      availableDrivers: string;
    }>(
      `SELECT
         COUNT(DISTINCT pd.driver_profile_id)::text AS "totalDrivers",
         COUNT(DISTINCT pd.driver_profile_id) FILTER (
           WHERE dp.availability_status = 'available'
         )::text AS "availableDrivers"
       FROM partners p
       JOIN partner_drivers pd
         ON pd.partner_id = p.id
        AND pd.status = 'ACTIVE'
       JOIN driver_profiles dp
         ON dp.id = pd.driver_profile_id
       WHERE p.user_id = $1
         AND dp.verification_status = 'approved'`,
      [ownerId],
    );

    const tripsRes = await this.pool.query<{
      activeTrips: string;
      todayRevenue: string;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE r.status IN (
             'driver_assigned',
             'driver_arriving',
             'driver_arrived',
             'in_progress'
           )
         )::text AS "activeTrips",
         COALESCE(
           SUM(
             COALESCE(
               r.final_fare,
               r.fare_estimate,
               0
             )
           ) FILTER (
             WHERE r.status = 'completed'
               AND r.completed_at >= CURRENT_DATE
           ),
           0
         )::text AS "todayRevenue"
       FROM rides r
       JOIN vehicles v
         ON v.id = r.assigned_vehicle_id
       WHERE v.owner_id = $1`,
      [ownerId],
    );

    const docsRes = await this.pool.query<{
      pendingDocs: string;
    }>(
      `SELECT COUNT(*)::text AS "pendingDocs"
       FROM partner_documents pd
       JOIN partners p
         ON p.id = pd.partner_id
       WHERE p.user_id = $1
         AND pd.status IN ('PENDING', 'SUBMITTED')`,
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
      todayRevenue: Number((await this.revenue(ownerId)).summary.todayRevenuePaise) / 100,
    };
  }

  async listVehicles(ownerId: string, query?: FleetListQuery): Promise<FleetVehicle[]> {
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
      ownershipType: string;
      ownerNotes: string | null;
      operatingCityId: string | null;
      operatingLocation: FleetVehicle['operatingLocation'];
      verificationStatus: string;
      isActive: boolean;
      driverUserId: string | null;
      driverName: string | null;
      driverPhone: string | null;
      driverAvailability: string | null;
      activeCode: string | null;
      assignmentCodeStatus: string | null;
      assignmentDriverProfileId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>(
      `SELECT
         v.id,
         v.owner_id AS "ownerId",
         v.driver_profile_id AS "driverProfileId",
         v.make,
         v.model,
         v.color,
         v.plate_number AS "plateNumber",
         COALESCE(v.sector, 'passenger') AS "sector",
         COALESCE(v.category, 'sedan') AS "category",
         COALESCE(
           v.fuel_rate_per_km,
           0
         )::text AS "fuelRatePerKm",
         COALESCE(
           v.load_capacity_kg,
           0
         )::text AS "loadCapacityKg",
         v.manufacturing_year AS "year",
         v.fuel_type AS "fuelType",
         v.seating_capacity AS "seatingCapacity",
         v.registration_date::text AS "registrationDate",
         v.registration_expiry::text AS "registrationExpiry",
         COALESCE(
           v.is_commercial,
           TRUE
         ) AS "isCommercial",
         v.permit_details AS "permitDetails",
         v.ownership_type AS "ownershipType",v.owner_notes AS "ownerNotes", operating_city_id AS "operatingCityId", operating_location AS "operatingLocation",
         COALESCE(
           v.verification_status,
           'pending'
         ) AS "verificationStatus",
         v.is_active AS "isActive",
         u.id AS "driverUserId",
         CASE
           WHEN u.id IS NOT NULL
           THEN (
             u.first_name || ' ' || u.last_name
           )
           ELSE NULL
         END AS "driverName",
         u.phone AS "driverPhone",
         dp.availability_status AS "driverAvailability",
         v.joining_code AS "activeCode",
         v.joining_code AS "vehicleCode",
         CASE WHEN v.driver_profile_id IS NOT NULL THEN 'CLAIMED'
              WHEN v.is_active AND v.verification_status='approved' THEN 'ACTIVE'
              ELSE 'PENDING_APPROVAL' END AS "assignmentCodeStatus",
         ac.intended_driver_profile_id AS "assignmentDriverProfileId",
         v.created_at AS "createdAt",
         v.updated_at AS "updatedAt"
       FROM vehicles v
       LEFT JOIN driver_profiles dp
         ON dp.id = v.driver_profile_id
       LEFT JOIN users u
         ON u.id = dp.user_id
       LEFT JOIN LATERAL (
         SELECT code,status,intended_driver_profile_id
         FROM driver_assignment_codes
         WHERE vehicle_id = v.id
           AND code = v.joining_code
         ORDER BY created_at DESC
         LIMIT 1
       ) ac ON TRUE
       WHERE v.owner_id = $1
         AND ($2::text IS NULL OR concat_ws(' ',v.plate_number,v.make,v.model) ILIKE '%'||$2||'%')
         AND ($3::text IS NULL OR v.sector=$3) AND ($4::text IS NULL OR v.category=$4)
         AND ($5::boolean IS NULL OR v.is_active=$5)
       ORDER BY v.created_at DESC,v.id LIMIT $6 OFFSET $7`,
      [
        ownerId,
        query?.search ?? null,
        query?.sector ?? null,
        query?.category ?? null,
        query?.active === undefined ? null : query.active === 'true',
        query?.limit ?? 50,
        query?.offset ?? 0,
      ],
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
      ownershipType: row.ownershipType,
      ownerNotes: row.ownerNotes,
      operatingCityId: row.operatingCityId,
      operatingLocation: row.operatingLocation,
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
      vehicleCode: row.activeCode,
      assignmentCodeStatus: row.assignmentCodeStatus,
      assignmentDriverProfileId: row.assignmentDriverProfileId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async createVehicle(ownerId: string, input: CreateFleetVehicleInput): Promise<FleetVehicle> {
    requirePremiumOperatingLocation(input.sector, input.operatingLocation);
    if (input.operatingLocation) await validateOperatingLocation(input.operatingLocation);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize first-vehicle election across requests, before reading persisted vehicles.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('owner_first_vehicle:'||$1::text,0))",
        [ownerId],
      );
      const owner = (
        await client.query<{
          role: string;
          profile_id: string | null;
          approval_status: string | null;
        }>(
          `SELECT u.role,dp.id AS profile_id,p.approval_status FROM users u
         LEFT JOIN driver_profiles dp ON dp.user_id=u.id LEFT JOIN partners p ON p.user_id=u.id WHERE u.id=$1`,
          [ownerId],
        )
      ).rows[0];
      if (
        owner?.role === 'driver_fleet_owner' &&
        owner.approval_status === 'approved' &&
        !owner.profile_id
      )
        throw new AppError(
          'DRIVER_PROFILE_MISSING',
          'The Driver profile linked to this Driver + Fleet Owner account is missing',
          409,
        );
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [ownerId]);

      const configuredType = await client.query(
        `SELECT id FROM vehicle_types WHERE code=$1 AND sector=CASE WHEN $2='rental' THEN 'passenger' ELSE $2 END AND catalog_visible AND registration_active FOR SHARE`,
        [input.category, input.sector],
      );
      if (!configuredType.rowCount)
        throw new AppError(
          'INVALID_VEHICLE_CATEGORY',
          'Choose a published vehicle option from the current catalog',
          400,
        );

      const result = await client.query<FleetVehicle>(
        `INSERT INTO vehicles (
         owner_id,
         make,
         model,
         color,
         plate_number,
         sector,
         category,
         fuel_rate_per_km,
         load_capacity_kg,
         manufacturing_year,
         fuel_type,
         seating_capacity,
         registration_date,
         registration_expiry,
         is_commercial,
         permit_details,
         ownership_type, owner_notes, operating_city_id, operating_location,
         verification_status,
         is_active
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
         $12,
         $13,
         $14,
         $15,
         $16,
         $17, $18, $19, $20,
         'pending',
         FALSE
       )
       RETURNING
         id,
         owner_id AS "ownerId",
         driver_profile_id AS "driverProfileId",
         make,
         model,
         color,
         plate_number AS "plateNumber",
         sector,
         category,
         COALESCE(
           fuel_rate_per_km,
           0
         )::numeric AS "fuelRatePerKm",
         COALESCE(
           load_capacity_kg,
           0
         )::numeric AS "loadCapacityKg",
         manufacturing_year AS "year",
         fuel_type AS "fuelType",
         seating_capacity AS "seatingCapacity",
         registration_date::text AS "registrationDate",
         registration_expiry::text AS "registrationExpiry",
         is_commercial AS "isCommercial",
         permit_details AS "permitDetails",
         ownership_type AS "ownershipType", owner_notes AS "ownerNotes", operating_city_id AS "operatingCityId", operating_location AS "operatingLocation",
         verification_status AS "verificationStatus",
         is_active AS "isActive",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
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
          input.ownershipType ?? 'OWNED',
          input.ownerNotes ?? null,
          input.operatingCityId ?? null,
          input.operatingLocation ? JSON.stringify(input.operatingLocation) : null,
        ],
      );

      const vehicle = result.rows[0];

      if (!vehicle) {
        throw new Error('Failed to create fleet vehicle');
      }

      // Elect from all persisted vehicles, including pending/inactive vehicles.
      // The durable intent survives retirement/deletion and never promotes a later vehicle.
      await client.query(
        `INSERT INTO owner_first_vehicle_assignments(owner_id,vehicle_id)
         SELECT $1,id FROM vehicles WHERE owner_id=$1 ORDER BY created_at,id LIMIT 1
         ON CONFLICT(owner_id) DO NOTHING`,
        [ownerId],
      );
      await assignFirstOwnerVehicle(client, ownerId);
      const joining = await this.issueVehicleCode(client, ownerId, vehicle.id);
      await client.query('COMMIT');
      return {
        ...vehicle,
        vehicleCode: joining.code,
        activeAssignmentCode: joining.code,
        assignmentCodeStatus: 'PENDING_APPROVAL',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateVehicle(
    ownerId: string,
    vehicleId: string,
    input: UpdateFleetVehicleInput,
  ): Promise<FleetVehicle | null> {
    if (input.operatingLocation) await validateOperatingLocation(input.operatingLocation);
    if (input.sector === 'premium' || input.operatingCityId !== undefined) {
      const current = (
        await this.pool.query(
          'SELECT sector,operating_city_id,operating_location FROM vehicles WHERE id=$1 AND owner_id=$2',
          [vehicleId, ownerId],
        )
      ).rows[0];
      if (
        current &&
        ((input.sector === 'premium' && current.sector !== 'premium') ||
          (input.operatingCityId !== undefined &&
            input.operatingCityId !== current.operating_city_id &&
            !current.operating_location))
      )
        requirePremiumOperatingLocation(
          input.sector ?? current.sector,
          input.operatingLocation ?? current.operating_location,
        );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('provider_vehicle:'||$1::text,0))",
        [vehicleId],
      );
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [ownerId]);
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
        ownershipType: 'ownership_type',
        ownerNotes: 'owner_notes',
        operatingCityId: 'operating_city_id',
        operatingLocation: 'operating_location',
      };

      if (input.sector != null || input.category != null) {
        const current = (
          await client.query(
            'SELECT sector,category FROM vehicles WHERE id=$1 AND owner_id=$2 FOR UPDATE',
            [vehicleId, ownerId],
          )
        ).rows[0];
        if (!current) {
          await client.query('ROLLBACK');
          return null;
        }
        const sector = input.sector ?? current.sector,
          category = input.category ?? current.category;
        if (
          (sector !== current.sector || category !== current.category) &&
          !(
            await client.query(
              "SELECT id FROM vehicle_types WHERE code=$1 AND sector=CASE WHEN $2='rental' THEN 'passenger' ELSE $2 END AND catalog_visible AND registration_active FOR SHARE",
              [category, sector],
            )
          ).rowCount
        )
          throw new AppError(
            'INVALID_VEHICLE_CATEGORY',
            'Choose a published vehicle option from the current catalog',
            400,
          );
      }
      const fields = Object.keys(input) as (keyof UpdateFleetVehicleInput)[];

      if (fields.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const values = fields.map((field) =>
        field === 'operatingLocation'
          ? JSON.stringify(input.operatingLocation)
          : input[field] === undefined
            ? null
            : input[field],
      );

      const assignments = fields.map((field, index) => `${columns[field]} = $${index + 1}`);

      const result = await client.query<FleetVehicle>(
        `UPDATE vehicles
       SET ${assignments.join(', ')},
           updated_at = NOW()
       WHERE id = $${values.length + 1}
         AND owner_id = $${values.length + 2}
       RETURNING
         id,
         owner_id AS "ownerId",
         driver_profile_id AS "driverProfileId",
         make,
         model,
         color,
         plate_number AS "plateNumber",
         sector,
         category, operating_city_id AS "operatingCityId", operating_location AS "operatingLocation",
         is_active AS "isActive",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
        [...values, vehicleId, ownerId],
      );

      await client.query('COMMIT');
      return result.rows[0] ?? null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deactivateVehicle(ownerId: string, vehicleId: string): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('provider_vehicle:'||$1::text,0))",
        [vehicleId],
      );
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [ownerId]);

      const vehicleResult = await client.query<{
        driverProfileId: string | null;
      }>(
        `SELECT
           driver_profile_id AS "driverProfileId"
         FROM vehicles
         WHERE id = $1
           AND owner_id = $2
         FOR UPDATE`,
        [vehicleId, ownerId],
      );

      const vehicle = vehicleResult.rows[0];

      if (!vehicle) {
        await client.query('ROLLBACK');
        return false;
      }

      /*
       * Remove the driver's active vehicle pointer if this vehicle
       * was currently selected by the assigned driver.
       */
      if (vehicle.driverProfileId) {
        await client.query(
          `UPDATE driver_profiles
           SET active_vehicle_id = NULL,
               updated_at = NOW()
           WHERE id = $1
             AND active_vehicle_id = $2`,
          [vehicle.driverProfileId, vehicleId],
        );
      }

      /*
       * The vehicle must not remain assigned after deactivation.
       */
      await client.query(
        `UPDATE vehicles
         SET is_active = FALSE,
             driver_profile_id = NULL,
             retired_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
           AND owner_id = $2`,
        [vehicleId, ownerId],
      );

      /*
       * Any active assignment code becomes invalid immediately.
       */
      await client.query(
        `UPDATE driver_assignment_codes
         SET status = 'REVOKED',
             updated_at = NOW()
         WHERE vehicle_id = $1
           AND status IN ('ACTIVE','CLAIMED')`,
        [vehicleId],
      );

      await client.query('COMMIT');

      return true;
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

  private async issueVehicleCode(
    client: import('pg').PoolClient,
    ownerId: string,
    vehicleId: string,
    driverProfileId?: string,
  ) {
    const vehicle = (
      await client.query<{ joining_code: string }>(
        'SELECT joining_code FROM vehicles WHERE id=$1 AND owner_id=$2',
        [vehicleId, ownerId],
      )
    ).rows[0];
    if (!vehicle) throw new Error('VEHICLE_NOT_AVAILABLE_FOR_ASSIGNMENT');
    const expiresAt = new Date('9999-12-31T23:59:59.000Z');
    await client.query(
      'INSERT INTO driver_assignment_codes(code,vehicle_id,fleet_owner_id,expires_at,intended_driver_profile_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(code) DO NOTHING',
      [vehicle.joining_code, vehicleId, ownerId, expiresAt, driverProfileId ?? null],
    );
    return { code: vehicle.joining_code, expiresAt, permanent: true };
  }

  async generateAssignmentCode(
    ownerId: string,
    vehicleId: string,
    driverProfileId?: string,
  ): Promise<{
    code: string;
    expiresAt: Date;
    permanent?: boolean;
  }> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('provider_vehicle:'||$1::text,0))",
        [vehicleId],
      );
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [ownerId]);

      /*
       * Lock the vehicle so its assignment/deactivation state
       * cannot change while the code is being generated.
       */
      const vehicleResult = await client.query<{
        id: string;
        driver_profile_id: string | null;
      }>(
        `SELECT v.id,v.driver_profile_id
         FROM vehicles v
         WHERE v.id = $1
           AND v.owner_id = $2
         FOR UPDATE`,
        [vehicleId, ownerId],
      );

      if (!vehicleResult.rows[0]) {
        throw new Error('VEHICLE_NOT_AVAILABLE_FOR_ASSIGNMENT');
      }

      if (
        driverProfileId &&
        vehicleResult.rows[0].driver_profile_id &&
        vehicleResult.rows[0].driver_profile_id !== driverProfileId
      )
        throw new Error('VEHICLE_NOT_AVAILABLE_FOR_ASSIGNMENT');
      if (
        driverProfileId &&
        !(
          await client.query(
            `SELECT dp.id FROM driver_profiles dp JOIN partner_drivers pd ON pd.driver_profile_id=dp.id JOIN partners p ON p.id=pd.partner_id JOIN users u ON u.id=dp.user_id WHERE dp.id=$1 AND p.user_id=$2 AND pd.status='ACTIVE' AND dp.verification_status='approved' AND dp.license_expiry>=CURRENT_DATE AND (dp.active_vehicle_id IS NULL OR dp.active_vehicle_id=$3) AND u.status='active' AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM vehicles class_vehicle WHERE class_vehicle.id=$3 AND driver_licence_category_satisfied(dp.id,class_vehicle.category)) FOR SHARE OF dp,pd,u`,
            [driverProfileId, ownerId, vehicleId],
          )
        ).rowCount
      )
        throw new Error('DRIVER_NOT_ELIGIBLE_FOR_ASSIGNMENT');
      const { code, expiresAt } = await this.issueVehicleCode(
        client,
        ownerId,
        vehicleId,
        driverProfileId,
      );

      if (driverProfileId && !vehicleResult.rows[0].driver_profile_id) {
        await client.query(
          'UPDATE driver_assignment_codes SET intended_driver_profile_id=$2,updated_at=NOW() WHERE code=$1',
          [code, driverProfileId],
        );
      }
      await client.query('COMMIT');

      return {
        code,
        expiresAt,
        permanent: true,
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

  async unassignDriver(ownerId: string, vehicleId: string): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('provider_vehicle:'||$1::text,0))",
        [vehicleId],
      );
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [ownerId]);

      const vRes = await client.query<{
        driver_profile_id: string | null;
      }>(
        `SELECT
             driver_profile_id
           FROM vehicles
           WHERE id = $1
             AND owner_id = $2
           FOR UPDATE`,
        [vehicleId, ownerId],
      );

      const vehicle = vRes.rows[0];

      if (!vehicle) {
        throw new Error('VEHICLE_NOT_FOUND');
      }

      if (vehicle.driver_profile_id) {
        await client.query(
          `UPDATE driver_profiles
           SET active_vehicle_id = NULL,
               updated_at = NOW()
           WHERE id = $1
             AND active_vehicle_id = $2`,
          [vehicle.driver_profile_id, vehicleId],
        );
      }

      await client.query(
        `UPDATE vehicles
         SET driver_profile_id = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND owner_id = $2`,
        [vehicleId, ownerId],
      );

      await client.query(
        `UPDATE driver_assignment_codes SET status='REVOKED',updated_at=NOW()
         WHERE vehicle_id=$1 AND code<>(SELECT joining_code FROM vehicles WHERE id=$1)
         AND status IN ('ACTIVE','CLAIMED')`,
        [vehicleId],
      );
      await client.query(
        `UPDATE driver_assignment_codes SET status='ACTIVE',driver_id=NULL,
         intended_driver_profile_id=NULL,updated_at=NOW()
         WHERE vehicle_id=$1 AND code=(SELECT joining_code FROM vehicles WHERE id=$1)`,
        [vehicleId],
      );

      await client.query('COMMIT');

      return true;
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

  async listDrivers(ownerId: string, query?: FleetListQuery): Promise<FleetDriver[]> {
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
         dp.id,
         dp.user_id AS "userId",
         (
           u.first_name || ' ' || u.last_name
         ) AS "name",
         u.phone,
         u.email,
         dp.license_number AS "licenseNumber",
         dp.license_expiry::text AS "licenseExpiry",
         dp.verification_status AS "verificationStatus",
         dp.availability_status AS "availabilityStatus",

         v.id AS "vehicleId",
         v.make AS "vehicleMake",
         v.model AS "vehicleModel",
         v.plate_number AS "vehiclePlate",

         COUNT(r.id)::text AS "completedTrips",

         COALESCE(SUM(${paidRideRevenueSql}),0)::text AS "totalEarnings"

       FROM partners p

       JOIN partner_drivers pd
         ON pd.partner_id = p.id
        AND pd.status::text = COALESCE($2::text,'ACTIVE')

       JOIN driver_profiles dp
         ON dp.id = pd.driver_profile_id

       JOIN users u
         ON u.id = dp.user_id

       LEFT JOIN vehicles v
         ON v.driver_profile_id = dp.id
        AND dp.active_vehicle_id = v.id
        AND v.owner_id = p.user_id
        AND v.is_active = TRUE
        AND v.verification_status = 'approved'

       LEFT JOIN rides r
         ON r.assigned_driver_id = dp.id
        AND EXISTS(SELECT 1 FROM vehicles owned WHERE owned.id=r.assigned_vehicle_id AND owned.owner_id=p.user_id)
        AND r.status = 'completed'

       WHERE p.user_id = $1
         AND ($3::text IS NULL OR concat_ws(' ',u.first_name,u.last_name,u.phone,u.email) ILIKE '%'||$3||'%')
         AND ($4::text IS NULL OR dp.availability_status::text=$4)

       GROUP BY
         dp.id,
         u.id,
         dp.user_id,
         u.first_name,
         u.last_name,
         u.phone,
         u.email,
         dp.license_number,
         dp.license_expiry,
         dp.verification_status,
         dp.availability_status,
         v.id,
         v.make,
         v.model,
         v.plate_number

       ORDER BY u.first_name ASC,dp.id LIMIT $5 OFFSET $6`,
      [
        ownerId,
        query?.status ?? null,
        query?.search ?? null,
        query?.availability ?? null,
        query?.limit ?? 50,
        query?.offset ?? 0,
      ],
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
         r.id,
         v.id AS "vehicleId",
         v.plate_number AS "vehiclePlate",
         (
           u.first_name || ' ' || u.last_name
         ) AS "driverName",
         r.pickup_address AS "pickupAddress",
         r.destination_address AS "destinationAddress",
         r.status,
         r.fare_estimate::text AS "fareEstimate",
         r.final_fare::text AS "finalFare",
         r.actual_distance_meters AS "actualDistanceMeters",
         r.created_at AS "createdAt",
         r.completed_at AS "completedAt"
       FROM rides r
       JOIN vehicles v
         ON v.id = r.assigned_vehicle_id
       LEFT JOIN driver_profiles dp
         ON dp.id = r.assigned_driver_id
       LEFT JOIN users u
         ON u.id = dp.user_id
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
    const report = await this.revenue(ownerId);
    const settled = await this.pool.query<{ commission: string; net: string }>(
      "SELECT COALESCE(-SUM(amount_paise) FILTER(WHERE entry_type='COMMISSION'),0)::text AS commission,COALESCE(SUM(amount_paise) FILTER(WHERE entry_type IN ('EARNING','COMMISSION','ADJUSTMENT')),0)::text AS net FROM provider_wallet_entries WHERE user_id=$1 AND date_trunc('month',created_at AT TIME ZONE $2)=date_trunc('month',NOW() AT TIME ZONE $2)",
      [ownerId, env.FLEET_REPORT_TIME_ZONE],
    );
    return {
      todayRevenue: Number(report.summary.todayRevenuePaise) / 100,
      thisWeekRevenue: Number(report.summary.weekRevenuePaise) / 100,
      thisMonthRevenue: Number(report.summary.monthRevenuePaise) / 100,
      totalTrips: report.summary.completedJobs,
      platformCommission: Number(settled.rows[0]?.commission ?? '0') / 100,
      netPayout: Number(settled.rows[0]?.net ?? '0') / 100,
    };
  }
}
