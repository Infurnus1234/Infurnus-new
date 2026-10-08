import { AppError } from '../../../common/errors/app-error.js';
import type { VehicleType } from '../types/vehicle.js';
import type { CreateVehicleTypeInput, UpdateVehicleTypeInput } from '../schemas/vehicle.schemas.js';
import type { Pool } from 'pg';
import type { CreateVehicleData, UpdateVehicleData, Vehicle } from '../types/vehicle.js';

export interface CustomerFleetVehicle {
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
  findTypeByCode?(code: string): Promise<VehicleType | null>;
  listTypes?(limit: number, offset: number): Promise<VehicleType[]>;
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
  COALESCE(sector, 'passenger') AS "sector",
  COALESCE(category, 'sedan') AS "category",
  COALESCE(fuel_rate_per_km, 0)::numeric AS "fuelRatePerKm",
  COALESCE(load_capacity_kg, 0)::numeric AS "loadCapacityKg",
  manufacturing_year AS "manufacturingYear",
  fuel_type AS "fuelType",
  seating_capacity AS "seatingCapacity",
  registration_date AS "registrationDate",
  registration_expiry AS "registrationExpiry",
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
  async findTypeByCode(code: string): Promise<VehicleType | null> {
    const result = await this.pool.query('SELECT * FROM vehicle_types WHERE code=$1', [code]);
    return result.rows[0] ? mapType(result.rows[0]) : null;
  }
  async listTypes(limit: number, offset: number): Promise<VehicleType[]> {
    const result = await this.pool.query(
      'SELECT * FROM vehicle_types ORDER BY code LIMIT $1 OFFSET $2',
      [limit, offset],
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
        result = await client.query(
          'UPDATE vehicle_types SET name=$2,base_fare_paise=$3,per_km_rate_paise=$4,active=$5,version=version+1 WHERE id=$1 RETURNING *',
          [
            id,
            update.name ?? old.name,
            Math.round((update.baseFare ?? old.baseFare) * 100),
            Math.round((update.perKmRate ?? old.perKmRate) * 100),
            update.active ?? old.active,
          ],
        );
      } else {
        const create = input as CreateVehicleTypeInput;
        result = await client.query(
          'INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise,currency,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [
            create.name,
            create.code,
            create.sector,
            Math.round(create.baseFare * 100),
            Math.round(create.perKmRate * 100),
            create.currency,
            create.active,
          ],
        );
      }
      const vehicle = mapType(result.rows[0]);
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
          permit_details
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
          $17
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
    const columns: Record<keyof UpdateVehicleData, string> = {
      make: 'make',
      model: 'model',
      color: 'color',
      plateNumber: 'plate_number',
      sector: 'sector',
      category: 'category',
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

    const values = entries.map(([, value]) => value);

    const assignments = entries.map(([field], index) => `${columns[field]} = $${index + 1}`);

    const result = await this.pool.query<Vehicle>(
      `
        UPDATE vehicles
        SET
          ${assignments.join(', ')},
          updated_at = NOW()
        WHERE id = $${values.length + 1}
          AND is_active = TRUE
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

function mapType(row: Record<string, unknown>): VehicleType {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    sector: row.sector as VehicleType['sector'],
    baseFare: Number(row.base_fare_paise) / 100,
    perKmRate: Number(row.per_km_rate_paise) / 100,
    currency: 'INR',
    active: row.active as boolean,
    version: Number(row.version),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
