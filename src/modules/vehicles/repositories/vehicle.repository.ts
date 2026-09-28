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
