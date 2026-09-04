import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import type { VehicleRepository } from '../repositories/vehicle.repository.js';
import type { CreateVehicleData, UpdateVehicleData, Vehicle } from '../types/vehicle.js';

const driverProfileId = '750e8400-e29b-41d4-a716-446655440000';
const vehicle: Vehicle = {
  id: '850e8400-e29b-41d4-a716-446655440000',
  driverProfileId,
  make: 'Toyota',
  model: 'Innova',
  color: 'White',
  plateNumber: 'KA01AB1234',
  isActive: true,
  retiredAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

class InMemoryVehicleRepository implements VehicleRepository {
  private readonly vehicles = new Map([[vehicle.id, vehicle]]);

  async driverProfileExists(id: string) {
    return id === driverProfileId;
  }

  async create(data: CreateVehicleData) {
    if (!(await this.driverProfileExists(data.driverProfileId))) throw { code: '23503' };
    if (
      [...this.vehicles.values()].some(
        (item) => item.isActive && item.plateNumber === data.plateNumber,
      )
    ) {
      throw { code: '23505' };
    }
    const created: Vehicle = {
      ...vehicle,
      id: crypto.randomUUID(),
      driverProfileId: data.driverProfileId,
      make: data.make,
      model: data.model,
      color: data.color ?? null,
      plateNumber: data.plateNumber,
    };
    this.vehicles.set(created.id, created);
    return created;
  }

  async findById(id: string) {
    return this.vehicles.get(id) ?? null;
  }

  async findByDriver(driverId: string, activeOnly: boolean) {
    return [...this.vehicles.values()].filter(
      (item) => item.driverProfileId === driverId && (!activeOnly || item.isActive),
    );
  }

  async update(id: string, data: UpdateVehicleData) {
    const existing = this.vehicles.get(id);
    if (!existing || !existing.isActive) return null;
    const updated: Vehicle = {
      ...existing,
      make: data.make ?? existing.make,
      model: data.model ?? existing.model,
      color: data.color ?? existing.color,
      plateNumber: data.plateNumber ?? existing.plateNumber,
      updatedAt: new Date(),
    };
    this.vehicles.set(id, updated);
    return updated;
  }

  async deactivate(id: string, retiredAt: Date) {
    const existing = this.vehicles.get(id);
    if (!existing || !existing.isActive) return null;
    const updated: Vehicle = { ...existing, isActive: false, retiredAt, updatedAt: new Date() };
    this.vehicles.set(id, updated);
    return updated;
  }
}

describe('Vehicles API', () => {
  it('creates, retrieves, lists, updates, and deactivates vehicles', async () => {
    const app = createApp(undefined, undefined, new InMemoryVehicleRepository());
    const created = await request(app).post('/vehicles').send({
      driverProfileId,
      make: 'Honda',
      model: 'City',
      plateNumber: 'KA02CD5678',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.passwordHash).toBeUndefined();
    const id = created.body.data.id;
    expect((await request(app).get(`/vehicles/${id}`)).status).toBe(200);
    expect(
      (await request(app).get(`/vehicles?driverProfileId=${driverProfileId}`)).body.data,
    ).toHaveLength(2);
    const updated = await request(app).patch(`/vehicles/${id}`).send({ color: 'Blue' });
    expect(updated.status).toBe(200);
    const deactivated = await request(app).post(`/vehicles/${id}/deactivate`).send({});
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);
    expect(
      (await request(app).get(`/vehicles?driverProfileId=${driverProfileId}`)).body.data,
    ).toHaveLength(1);
  });

  it('handles validation, conflicts, and missing driver profiles', async () => {
    const app = createApp(undefined, undefined, new InMemoryVehicleRepository());
    expect((await request(app).post('/vehicles').send({ driverProfileId: 'bad' })).status).toBe(
      400,
    );
    const duplicate = await request(app)
      .post('/vehicles')
      .send({ driverProfileId, make: 'Ford', model: 'Ecosport', plateNumber: vehicle.plateNumber });
    expect(duplicate.status).toBe(409);
    const missing = await request(app).get(
      '/vehicles?driverProfileId=950e8400-e29b-41d4-a716-446655440000',
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('DRIVER_PROFILE_NOT_FOUND');
  });
});
