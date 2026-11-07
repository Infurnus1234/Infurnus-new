import {
  validateOperatingLocation,
  requirePremiumOperatingLocation,
} from '../../maps/vehicle-operating-location.js';
import { hourlyPricingFromRow } from '../services/hourly-pricing.js';
import { vehiclePricingReferenceSchema } from '../schemas/vehicle.schemas.js';
import { vehiclePricingStatus } from '../services/vehicle-pricing-status.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { VehicleType } from '../types/vehicle.js';
import type { CreateVehicleTypeInput, UpdateVehicleTypeInput } from '../schemas/vehicle.schemas.js';
import type { Pool } from 'pg';
import type { CreateVehicleData, UpdateVehicleData, Vehicle } from '../types/vehicle.js';

export interface CustomerFleetVehicle {
  name?: string | null;
  id: string;
  make: string;
  model: string;
  color: string | null;
  sector: string;
  category: string;
  fuelRatePerKm: number;
  loadCapacityKg: number;
}

export interface VehicleRepository {
  driverProfileOwnerId?(id: string): Promise<string | null>;
  createType?(actorId: string, input: CreateVehicleTypeInput): Promise<VehicleType>;
  updateType?(actorId: string, id: string, input: UpdateVehicleTypeInput): Promise<VehicleType>;
  getType?(id: string): Promise<VehicleType | null>;
  findTypeByCode?(code: string, sector?: string): Promise<VehicleType | null>;
  measureBookingDemand?(
    sector: string,
    codes: string[],
    windowSeconds: number,
  ): Promise<import('../../fares/services/demand-pricing.js').BookingDemandSample>;
  listTypes?(
    limit: number,
    offset: number,
    sector?: string,
    activeOnly?: boolean,
    excludeSector?: string,
    catalogOnly?: boolean,
    registrationOnly?: boolean,
  ): Promise<VehicleType[]>;
  driverProfileExists(id: string): Promise<boolean>;

  create(data: CreateVehicleData): Promise<Vehicle>;

  findById(id: string): Promise<Vehicle | null>;

  findByDriver(driverProfileId: string, activeOnly: boolean): Promise<Vehicle[]>;

  update(id: string, data: UpdateVehicleData): Promise<Vehicle | null>;

  deactivate(id: string, retiredAt: Date): Promise<Vehicle | null>;

  listFleet(sector?: string, category?: string): Promise<CustomerFleetVehicle[]>;
}

const vehicleProjection = `
  id,
  driver_profile_id AS "driverProfileId",
  owner_id AS "ownerId",
  make,
  model,
  color,
  plate_number AS "plateNumber",
  operating_city_id AS "operatingCityId", operating_location AS "operatingLocation",
  COALESCE(sector, 'passenger') AS "sector",
  COALESCE(category, 'sedan') AS "category",
  COALESCE(fuel_rate_per_km, 0)::numeric AS "fuelRatePerKm",
  COALESCE(load_capacity_kg, 0)::numeric AS "loadCapacityKg",
  manufacturing_year AS "manufacturingYear",
  fuel_type AS "fuelType",
  seating_capacity AS "seatingCapacity",
  registration_date::text AS "registrationDate",
  registration_expiry::text AS "registrationExpiry",
  is_commercial AS "isCommercial",
  permit_details AS "permitDetails",
  verification_status AS "verificationStatus",
  is_active AS "isActive",
  retired_at AS "retiredAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function mapVehicleRow(row: Vehicle): Vehicle {
  return {
    ...row,
    fuelRatePerKm: Number(row.fuelRatePerKm ?? 0),
    loadCapacityKg: Number(row.loadCapacityKg ?? 0),
  };
}

export class PostgresVehicleRepository implements VehicleRepository {
  constructor(private readonly pool: Pool) {}
  async driverProfileOwnerId(id: string) {
    return (
      (
        await this.pool.query<{ user_id: string }>(
          'SELECT user_id FROM driver_profiles WHERE id=$1',
          [id],
        )
      ).rows[0]?.user_id ?? null
    );
  }

  async getType(id: string): Promise<VehicleType | null> {
    const result = await this.pool.query('SELECT * FROM vehicle_types WHERE id=$1', [id]);
    return result.rows[0] ? mapType(result.rows[0]) : null;
  }
  async findTypeByCode(code: string, sector?: string): Promise<VehicleType | null> {
    const result = await this.pool.query(
      'SELECT * FROM vehicle_types WHERE code=$1 AND ($2::text IS NULL OR sector=$2)',
      [code, sector ?? null],
    );
    if (result.rows.length > 1)
      throw new AppError('VEHICLE_TYPE_AMBIGUOUS', 'Sector is required for this vehicle code', 422);
    return result.rows[0] ? mapType(result.rows[0]) : null;
  }
  async measureBookingDemand(sector: string, codes: string[], windowSeconds: number) {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int count, NOW() measured_at FROM rides WHERE sector=$1 AND vehicle_category=ANY($2::text[]) AND created_at >= NOW()-make_interval(secs => $3::int)`,
      [sector, codes, windowSeconds],
    );
    return {
      count: Number(result.rows[0].count),
      measuredAt: new Date(result.rows[0].measured_at).toISOString(),
    };
  }
  async listTypes(
    limit: number,
    offset: number,
    sector?: string,
    activeOnly?: boolean,
    excludeSector?: string,
    catalogOnly?: boolean,
    registrationOnly?: boolean,
  ): Promise<VehicleType[]> {
    const result = await this.pool.query(
      'SELECT * FROM vehicle_types WHERE ($3::text IS NULL OR sector=$3) AND (NOT $4::boolean OR active) AND ($5::text IS NULL OR sector<>$5) AND (NOT $6::boolean OR catalog_visible) AND (NOT $7::boolean OR registration_active) ORDER BY catalog_order,name,sector,id LIMIT $1 OFFSET $2',
      [
        limit,
        offset,
        sector ?? null,
        activeOnly ?? false,
        excludeSector ?? null,
        catalogOnly ?? false,
        registrationOnly ?? false,
      ],
    );
    return result.rows.map(mapType);
  }
  async createType(actorId: string, input: CreateVehicleTypeInput): Promise<VehicleType> {
    return this.mutateType(actorId, undefined, input);
  }
  async updateType(
    actorId: string,
    id: string,
    input: UpdateVehicleTypeInput,
  ): Promise<VehicleType> {
    return this.mutateType(actorId, id, input);
  }
  private async mutateType(
    actorId: string,
    id: string | undefined,
    input: CreateVehicleTypeInput | UpdateVehicleTypeInput,
  ): Promise<VehicleType> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Defense in depth: reuse the platform roles, including active/deleted state.
      const actor = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role IN ('admin','super_admin') AND status='active' AND deleted_at IS NULL FOR SHARE",
        [actorId],
      );
      if (!actor.rowCount) throw new AppError('FORBIDDEN', 'Admin access required', 403);
      // Serialize creation as well as updates against in-flight bookings for this code.
      // Row locks alone cannot protect a catalog entry that does not exist yet.
      const identity = id
        ? (await client.query('SELECT code FROM vehicle_types WHERE id=$1', [id])).rows[0]?.code
        : (input as CreateVehicleTypeInput).code;
      if (!identity) throw new AppError('VEHICLE_TYPE_NOT_FOUND', 'Vehicle type not found', 404);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,648032))', [identity]);
      let old: VehicleType | null = null;
      let result;
      if (id) {
        const previous = await client.query('SELECT * FROM vehicle_types WHERE id=$1 FOR UPDATE', [
          id,
        ]);
        if (!previous.rows[0])
          throw new AppError('VEHICLE_TYPE_NOT_FOUND', 'Vehicle type not found', 404);
        old = mapType(previous.rows[0]);
        const update = input as UpdateVehicleTypeInput;
        if (old.version !== update.expectedVersion)
          throw new AppError(
            'VEHICLE_TYPE_VERSION_CONFLICT',
            'Configuration changed; reload before updating.',
            409,
          );
        let reference =
          update.pricingReference === undefined ? old.pricingReference : update.pricingReference;
        if (
          old.pricingReference?.demandPricing &&
          update.hourlyBaseFares == null &&
          update.logisticsSlabs == null
        ) {
          if (!reference)
            throw new AppError(
              'VEHICLE_TYPE_INVALID',
              'Demand pricing cannot be removed through a scalar update.',
              422,
            );
          if (!reference.demandPricing)
            reference = { ...reference, demandPricing: old.pricingReference.demandPricing };
        }
        result = await client.query(
          'UPDATE vehicle_types SET name=$2,base_fare_paise=$3,per_km_rate_paise=$4,active=$5,pricing_reference=$6::jsonb,hourly_base_fares_paise=$7::jsonb,hourly_missing_duration_policy=$8,extended_duration_policy=$9,logistics_slabs=$10::jsonb,service_fixed_fare_paise=$11,service_radius_meters=$12,catalog_visible=$13,registration_active=$14,version=version+1 WHERE id=$1 RETURNING *',
          [
            id,
            update.name ?? old.name,
            (update.baseFare === undefined ? old.baseFare : update.baseFare) === null
              ? null
              : Math.round(
                  (update.baseFare === undefined ? old.baseFare! : update.baseFare!) * 100,
                ),
            (update.perKmRate === undefined ? old.perKmRate : update.perKmRate) === null
              ? null
              : Math.round(
                  (update.perKmRate === undefined ? old.perKmRate! : update.perKmRate!) * 100,
                ),
            update.active ?? old.active,
            reference ? JSON.stringify(reference) : null,
            hourlyJson(
              update.hourlyBaseFares === undefined
                ? old.hourlyBaseFares
                : update.hourlyBaseFares === null
                  ? null
                  : { ...old.hourlyBaseFares, ...update.hourlyBaseFares },
            ),
            update.missingDurationPolicy ??
              (update.hourlyBaseFares != null ? 'require_duration' : old.missingDurationPolicy) ??
              'require_duration',
            update.extendedDurationPolicy === undefined
              ? update.hourlyBaseFares != null
                ? 'booked_duration'
                : (old.extendedDurationPolicy ?? null)
              : update.extendedDurationPolicy,
            logisticsJson(
              update.logisticsSlabs === undefined
                ? (old.logisticsSlabs ?? null)
                : update.logisticsSlabs,
            ),
            (update.serviceFixedFare === undefined
              ? old.serviceFixedFare
              : update.serviceFixedFare) == null
              ? null
              : Math.round(
                  (update.serviceFixedFare === undefined
                    ? old.serviceFixedFare!
                    : update.serviceFixedFare!) * 100,
                ),
            update.serviceRadiusMeters ?? old.serviceRadiusMeters ?? 25000,
            update.catalogVisible ?? old.catalogVisible ?? true,
            update.registrationActive ?? old.registrationActive ?? false,
          ],
        );
      } else {
        const create = input as CreateVehicleTypeInput;
        result = await client.query(
          'INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise,currency,active,pricing_reference,hourly_base_fares_paise,hourly_missing_duration_policy,extended_duration_policy,logistics_slabs,service_fixed_fare_paise,service_radius_meters,catalog_visible,registration_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13,$14,$15,$16) RETURNING *',
          [
            create.name,
            create.code,
            create.sector,
            create.baseFare === null ? null : Math.round(create.baseFare * 100),
            create.perKmRate === null ? null : Math.round(create.perKmRate * 100),
            create.currency,
            create.active,
            create.pricingReference ? JSON.stringify(create.pricingReference) : null,
            hourlyJson(create.hourlyBaseFares),
            create.missingDurationPolicy ?? 'require_duration',
            create.extendedDurationPolicy === undefined
              ? create.hourlyBaseFares != null
                ? 'booked_duration'
                : null
              : create.extendedDurationPolicy,
            logisticsJson(create.logisticsSlabs),
            create.serviceFixedFare == null ? null : Math.round(create.serviceFixedFare * 100),
            create.serviceRadiusMeters ?? 25000,
            create.catalogVisible ?? true,
            create.registrationActive ?? false,
          ],
        );
      }
      const vehicle = mapType(result.rows[0]);
      if (
        vehicle.sector === 'service' &&
        (vehicle.baseFare !== null ||
          vehicle.perKmRate !== null ||
          vehicle.pricingReference ||
          vehicle.hourlyBaseFares ||
          vehicle.logisticsSlabs ||
          (vehicle.active && vehicle.serviceFixedFare == null))
      )
        throw new AppError(
          'SERVICE_CONFIGURATION_INVALID',
          'Service types require an independent fixed fare and cannot use distance, demand or hourly pricing.',
          422,
        );
      if (vehicle.sector !== 'service' && vehicle.serviceFixedFare != null)
        throw new AppError(
          'SERVICE_CONFIGURATION_INVALID',
          'Service pricing is only available for Service types.',
          422,
        );
      if (vehicle.pricingReference) {
        vehiclePricingReferenceSchema.parse(vehicle.pricingReference);
        if (vehicle.baseFare !== null || vehicle.perKmRate !== null)
          throw new AppError(
            'VEHICLE_TYPE_INVALID',
            'Use either exact scalar rates or a pricing reference, not both',
            422,
          );
      }
      if (
        vehicle.sector !== 'service' &&
        !vehicle.logisticsSlabs &&
        (vehicle.baseFare === null || vehicle.perKmRate === null) &&
        (!vehicle.pricingReference || vehicle.baseFare !== null || vehicle.perKmRate !== null) &&
        !(
          vehicle.active === false &&
          vehicle.baseFare === null &&
          vehicle.perKmRate === null &&
          !vehicle.pricingReference
        )
      )
        throw new AppError(
          'VEHICLE_TYPE_INVALID',
          'Configure both fixed rates or an approximate pricing reference.',
          422,
        );
      if (
        !vehicle.logisticsSlabs &&
        vehicle.code === 'ftl' &&
        (vehicle.active || vehicle.pricingReference) &&
        (vehicle.baseFare !== null ||
          vehicle.perKmRate !== null ||
          vehicle.pricingReference?.routeBased !== true)
      )
        throw new AppError(
          'VEHICLE_TYPE_INVALID',
          'FTL requires route-based pricing, not an arbitrary fixed quote.',
          422,
        );
      await client.query(
        "INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,$2,'vehicle_type',$3,$4::jsonb)",
        [
          actorId,
          id ? 'vehicle_type_updated' : 'vehicle_type_created',
          vehicle.id,
          JSON.stringify({ old, new: vehicle }),
        ],
      );
      await client.query('COMMIT');
      return vehicle;
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505')
        throw new AppError('VEHICLE_TYPE_DUPLICATE', 'Vehicle code already exists', 409);
      if ((error as { code?: string }).code === '23514')
        throw new AppError(
          'VEHICLE_TYPE_INVALID',
          'Configure valid pricing before activating this category.',
          422,
        );
      throw error;
    } finally {
      client.release();
    }
  }

  async driverProfileExists(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        SELECT 1
        FROM driver_profiles
        WHERE id = $1
      `,
      [id],
    );

    return result.rowCount === 1;
  }

  async create(data: CreateVehicleData): Promise<Vehicle> {
    requirePremiumOperatingLocation(data.sector ?? 'passenger', data.operatingLocation);
    if (data.operatingLocation) await validateOperatingLocation(data.operatingLocation);

    const result = await this.pool.query<Vehicle>(
      `
        INSERT INTO vehicles (
          driver_profile_id,
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
          permit_details, operating_city_id, operating_location
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          COALESCE($7, 'passenger'),
          COALESCE($8, 'sedan'),
          COALESCE($9, 0),
          COALESCE($10, 0),
          $11,
          $12,
          $13,
          $14,
          $15,
          COALESCE($16, TRUE),
          $17, $18, $19
        )
        RETURNING ${vehicleProjection}
      `,
      [
        data.driverProfileId ?? null,
        data.ownerId ?? null,
        data.make,
        data.model,
        data.color ?? null,
        data.plateNumber,
        data.sector ?? 'passenger',
        data.category ?? 'sedan',
        data.fuelRatePerKm ?? 0,
        data.loadCapacityKg ?? 0,
        data.manufacturingYear ?? null,
        data.fuelType ?? null,
        data.seatingCapacity ?? null,
        data.registrationDate ?? null,
        data.registrationExpiry ?? null,
        data.isCommercial ?? true,
        data.permitDetails ?? null,
        data.operatingCityId ?? null,
        data.operatingLocation ? JSON.stringify(data.operatingLocation) : null,
      ],
    );

    const vehicle = result.rows.at(0);

    if (!vehicle) {
      throw new Error('Vehicle insert returned no row');
    }

    return mapVehicleRow(vehicle);
  }

  async findById(id: string): Promise<Vehicle | null> {
    const result = await this.pool.query<Vehicle>(
      `
        SELECT ${vehicleProjection}
        FROM vehicles
        WHERE id = $1
      `,
      [id],
    );

    const vehicle = result.rows[0];

    return vehicle ? mapVehicleRow(vehicle) : null;
  }

  async findByDriver(driverProfileId: string, activeOnly: boolean): Promise<Vehicle[]> {
    const result = await this.pool.query<Vehicle>(
      `
        SELECT ${vehicleProjection}
        FROM vehicles
        WHERE driver_profile_id = $1
          AND ($2 = FALSE OR is_active = TRUE)
        ORDER BY created_at DESC
      `,
      [driverProfileId, activeOnly],
    );

    return result.rows.map(mapVehicleRow);
  }

  async update(id: string, data: UpdateVehicleData): Promise<Vehicle | null> {
    if (data.operatingLocation) await validateOperatingLocation(data.operatingLocation);
    if (data.sector === 'premium' || data.operatingCityId !== undefined) {
      const current = await this.findById(id);
      if (
        current &&
        ((data.sector === 'premium' && current.sector !== 'premium') ||
          (data.operatingCityId !== undefined &&
            data.operatingCityId !== current.operatingCityId &&
            !current.operatingLocation))
      )
        requirePremiumOperatingLocation(
          data.sector ?? current.sector,
          data.operatingLocation ?? current.operatingLocation,
        );
    }

    const columns: Record<keyof UpdateVehicleData, string> = {
      make: 'make',
      model: 'model',
      color: 'color',
      plateNumber: 'plate_number',
      sector: 'sector',
      category: 'category',
      operatingCityId: 'operating_city_id',
      operatingLocation: 'operating_location',
      fuelRatePerKm: 'fuel_rate_per_km',
      loadCapacityKg: 'load_capacity_kg',
      manufacturingYear: 'manufacturing_year',
      fuelType: 'fuel_type',
      seatingCapacity: 'seating_capacity',
      registrationDate: 'registration_date',
      registrationExpiry: 'registration_expiry',
      isCommercial: 'is_commercial',
      permitDetails: 'permit_details',
    };

    const entries = Object.entries(data).filter(([, value]) => value !== undefined) as Array<
      [keyof UpdateVehicleData, Exclude<UpdateVehicleData[keyof UpdateVehicleData], undefined>]
    >;

    if (entries.length === 0) {
      return this.findById(id);
    }

    const values = entries.map(([field, value]) =>
      field === 'operatingLocation' ? JSON.stringify(value) : value,
    );

    const assignments = entries.map(([field], index) => `${columns[field]} = $${index + 1}`);

    const result = await this.pool.query<Vehicle>(
      `
        UPDATE vehicles
        SET
          ${assignments.join(', ')},
          updated_at = NOW()
        WHERE id = $${values.length + 1}
          AND retired_at IS NULL
        RETURNING ${vehicleProjection}
      `,
      [...values, id],
    );

    const vehicle = result.rows[0];

    return vehicle ? mapVehicleRow(vehicle) : null;
  }

  async deactivate(id: string, retiredAt: Date): Promise<Vehicle | null> {
    const result = await this.pool.query<Vehicle>(
      `
        UPDATE vehicles
        SET
          is_active = FALSE,
          retired_at = $1,
          updated_at = NOW()
        WHERE id = $2
          AND is_active = TRUE
        RETURNING ${vehicleProjection}
      `,
      [retiredAt, id],
    );

    const vehicle = result.rows[0];

    return vehicle ? mapVehicleRow(vehicle) : null;
  }

  async listFleet(sector?: string, category?: string): Promise<CustomerFleetVehicle[]> {
    const conditions: string[] = ['is_active = TRUE', `verification_status = 'approved'`];

    const params: unknown[] = [];

    if (sector) {
      params.push(sector);
      conditions.push(`sector = $${params.length}`);
    }

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const result = await this.pool.query<CustomerFleetVehicle>(
      `
        SELECT
          id,
          (SELECT t.name FROM vehicle_types t WHERE t.code=vehicles.category AND t.sector=vehicles.sector) AS name,
          make,
          model,
          color,
          COALESCE(sector, 'passenger') AS "sector",
          COALESCE(category, 'sedan') AS "category",
          COALESCE(fuel_rate_per_km, 0)::numeric AS "fuelRatePerKm",
          COALESCE(load_capacity_kg, 0)::numeric AS "loadCapacityKg"
        FROM vehicles
        WHERE ${conditions.join(' AND ')}
        ORDER BY make ASC, model ASC
      `,
      params,
    );

    return result.rows.map((row) => ({
      id: row.id,
      ...(row.name ? { name: row.name } : {}),
      make: row.make,
      model: row.model,
      color: row.color,
      sector: row.sector,
      category: row.category,
      fuelRatePerKm: Number(row.fuelRatePerKm ?? 0),
      loadCapacityKg: Number(row.loadCapacityKg ?? 0),
    }));
  }
}

function hourlyJson(fares: VehicleType['hourlyBaseFares']): string | null {
  return fares == null
    ? null
    : JSON.stringify(
        Object.fromEntries(
          Object.entries(fares).map(([key, value]) => [key, Math.round(value! * 100)]),
        ),
      );
}

function mapType(row: Record<string, unknown>): VehicleType {
  const type: VehicleType = {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    sector: row.sector as VehicleType['sector'],
    baseFare: row.base_fare_paise === null ? null : Number(row.base_fare_paise) / 100,
    pricingReference: (row.pricing_reference as VehicleType['pricingReference']) ?? null,
    perKmRate: row.per_km_rate_paise === null ? null : Number(row.per_km_rate_paise) / 100,
    currency: 'INR',
    serviceFixedFare:
      row.service_fixed_fare_paise == null ? null : Number(row.service_fixed_fare_paise) / 100,
    serviceRadiusMeters: Number(row.service_radius_meters ?? 25000),
    ...hourlyPricingFromRow(row),
    logisticsSlabs: (row.logistics_slabs as VehicleType['logisticsSlabs']) ?? null,
    active: row.active as boolean,
    catalogVisible: row.catalog_visible !== false,
    registrationActive: row.registration_active === true,
    version: Number(row.version),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
  return { ...type, pricingStatus: vehiclePricingStatus(type) };
}

function logisticsJson(slabs: VehicleType['logisticsSlabs']): string | null {
  return slabs == null ? null : JSON.stringify(slabs);
}
