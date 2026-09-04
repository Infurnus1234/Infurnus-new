import type { Pool } from 'pg';
import type { CreateVehicleData, UpdateVehicleData, Vehicle } from '../types/vehicle.js';

export interface VehicleRepository {
  driverProfileExists(id: string): Promise<boolean>;
  create(data: CreateVehicleData): Promise<Vehicle>;
  findById(id: string): Promise<Vehicle | null>;
  findByDriver(driverProfileId: string, activeOnly: boolean): Promise<Vehicle[]>;
  update(id: string, data: UpdateVehicleData): Promise<Vehicle | null>;
  deactivate(id: string, retiredAt: Date): Promise<Vehicle | null>;
}

const vehicleProjection = `
  id, driver_profile_id AS "driverProfileId", make, model, color,
  plate_number AS "plateNumber", is_active AS "isActive", retired_at AS "retiredAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export class PostgresVehicleRepository implements VehicleRepository {
  constructor(private readonly pool: Pool) {}

  async driverProfileExists(id: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM driver_profiles WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  async create(data: CreateVehicleData): Promise<Vehicle> {
    const result = await this.pool.query<Vehicle>(
      `INSERT INTO vehicles (driver_profile_id, make, model, color, plate_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${vehicleProjection}`,
      [data.driverProfileId, data.make, data.model, data.color ?? null, data.plateNumber],
    );
    const vehicle = result.rows.at(0);
    if (!vehicle) throw new Error('Vehicle insert returned no row');
    return vehicle;
  }

  async findById(id: string): Promise<Vehicle | null> {
    const result = await this.pool.query<Vehicle>(
      `SELECT ${vehicleProjection} FROM vehicles WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByDriver(driverProfileId: string, activeOnly: boolean): Promise<Vehicle[]> {
    const result = await this.pool.query<Vehicle>(
      `SELECT ${vehicleProjection}
       FROM vehicles
       WHERE driver_profile_id = $1
         AND ($2 = FALSE OR is_active = TRUE)
       ORDER BY created_at DESC`,
      [driverProfileId, activeOnly],
    );
    return result.rows;
  }

  async update(id: string, data: UpdateVehicleData): Promise<Vehicle | null> {
    const columns: Record<string, string> = {
      make: 'make',
      model: 'model',
      color: 'color',
      plateNumber: 'plate_number',
    };
    const fields = Object.keys(data);
    const values = Object.values(data).map((value) => (value === undefined ? null : value));
    const assignments = fields.map((field, index) => `${columns[field]} = $${index + 1}`);
    const result = await this.pool.query<Vehicle>(
      `UPDATE vehicles SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length + 1} AND is_active = TRUE
       RETURNING ${vehicleProjection}`,
      [...values, id],
    );
    return result.rows[0] ?? null;
  }

  async deactivate(id: string, retiredAt: Date): Promise<Vehicle | null> {
    const result = await this.pool.query<Vehicle>(
      `UPDATE vehicles SET is_active = FALSE, retired_at = $1, updated_at = NOW()
       WHERE id = $2 AND is_active = TRUE
       RETURNING ${vehicleProjection}`,
      [retiredAt, id],
    );
    return result.rows[0] ?? null;
  }
}
