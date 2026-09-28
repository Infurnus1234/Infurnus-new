import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { VehicleRepository } from '../repositories/vehicle.repository.js';
import type { CreateVehicleData, UpdateVehicleData, Vehicle } from '../types/vehicle.js';

const driverProfileId = '750e8400-e29b-41d4-a716-446655440000';

const vehicle: Vehicle = {
  id: '850e8400-e29b-41d4-a716-446655440000',
  driverProfileId,
  ownerId: null,
  make: 'Toyota',
  model: 'Innova',
  color: 'White',
  plateNumber: 'KA01AB1234',
  sector: 'passenger',
  category: 'suv',
  fuelRatePerKm: 0,
  loadCapacityKg: 0,
  manufacturingYear: 2024,
  fuelType: 'petrol',
  seatingCapacity: 7,
  registrationDate: new Date('2024-01-01T00:00:00.000Z'),
  registrationExpiry: new Date('2034-01-01T00:00:00.000Z'),
  isCommercial: true,
  permitDetails: null,
  verificationStatus: 'approved',
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
    if (data.driverProfileId && !(await this.driverProfileExists(data.driverProfileId))) {
      throw { code: '23503' };
    }

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
      driverProfileId: data.driverProfileId ?? null,
      ownerId: data.ownerId ?? null,
      make: data.make,
      model: data.model,
      color: data.color ?? null,
      plateNumber: data.plateNumber,
      sector: data.sector ?? 'passenger',
      category: data.category ?? 'sedan',
      fuelRatePerKm: data.fuelRatePerKm ?? 0,
      loadCapacityKg: data.loadCapacityKg ?? 0,
      manufacturingYear: data.manufacturingYear ?? null,
      fuelType: data.fuelType ?? null,
      seatingCapacity: data.seatingCapacity ?? null,
      registrationDate: data.registrationDate ?? null,
      registrationExpiry: data.registrationExpiry ?? null,
      isCommercial: data.isCommercial ?? true,
      permitDetails: data.permitDetails ?? null,
      verificationStatus: 'pending',
      isActive: false,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
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

    if (!existing || !existing.isActive) {
      return null;
    }

    const updated: Vehicle = {
      ...existing,
      make: data.make ?? existing.make,
      model: data.model ?? existing.model,
      color: data.color ?? existing.color,
      plateNumber: data.plateNumber ?? existing.plateNumber,
      sector: data.sector ?? existing.sector,
      category: data.category ?? existing.category,
      fuelRatePerKm: data.fuelRatePerKm ?? existing.fuelRatePerKm,
      loadCapacityKg: data.loadCapacityKg ?? existing.loadCapacityKg,
      manufacturingYear: data.manufacturingYear ?? existing.manufacturingYear,
      fuelType: data.fuelType ?? existing.fuelType,
      seatingCapacity: data.seatingCapacity ?? existing.seatingCapacity,
      registrationDate: data.registrationDate ?? existing.registrationDate,
      registrationExpiry: data.registrationExpiry ?? existing.registrationExpiry,
      isCommercial: data.isCommercial ?? existing.isCommercial,
      permitDetails: data.permitDetails ?? existing.permitDetails,
      updatedAt: new Date(),
    };

    this.vehicles.set(id, updated);
    return updated;
  }

  async deactivate(id: string, retiredAt: Date) {
    const existing = this.vehicles.get(id);

    if (!existing || !existing.isActive) {
      return null;
    }

    const updated: Vehicle = {
      ...existing,
      isActive: false,
      retiredAt,
      updatedAt: new Date(),
    };

    this.vehicles.set(id, updated);
    return updated;
  }

  async listFleet(sector?: string, category?: string) {
    return [...this.vehicles.values()]
      .filter(
        (item) =>
          item.isActive &&
          item.verificationStatus === 'approved' &&
          (!sector || item.sector === sector) &&
          (!category || item.category === category),
      )
      .map((item) => ({
        id: item.id,
        make: item.make,
        model: item.model,
        color: item.color,
        sector: item.sector,
        category: item.category,
        fuelRatePerKm: item.fuelRatePerKm,
        loadCapacityKg: item.loadCapacityKg,
      }));
  }
}

describe('Vehicles API', () => {
  const getAuthToken = () =>
    signAccessToken({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      role: 'driver',
      type: 'access',
    });

  it('rejects unauthenticated requests with 401', async () => {
    const app = createApp(undefined, undefined, new InMemoryVehicleRepository());

    const response = await request(app).get('/vehicles');

    expect(response.status).toBe(401);
  });

  it('creates, retrieves, lists, updates, and deactivates vehicles', async () => {
    const repository = new InMemoryVehicleRepository();

    const app = createApp(undefined, undefined, repository);

    const token = await getAuthToken();

    const created = await request(app)
      .post('/vehicles')
      .set('authorization', `Bearer ${token}`)
      .send({
        driverProfileId,
        make: 'Honda',
        model: 'City',
        plateNumber: 'KA02CD5678',
      });

    expect(created.status).toBe(201);
    expect(created.body.data.passwordHash).toBeUndefined();
    expect(created.body.data.verificationStatus).toBe('pending');
    expect(created.body.data.isActive).toBe(false);

    const id = created.body.data.id;

    expect(
      (await request(app).get(`/vehicles/${id}`).set('authorization', `Bearer ${token}`)).status,
    ).toBe(200);

    await repository.update(id, {
      color: 'Blue',
    });

    const pendingFleet = (
      await request(app)
        .get(`/vehicles?driverProfileId=${driverProfileId}`)
        .set('authorization', `Bearer ${token}`)
    ).body.data;

    expect(pendingFleet).toHaveLength(1);

    const approvedVehicle = await repository.findById(id);

    expect(approvedVehicle).not.toBeNull();

    if (!approvedVehicle) {
      throw new Error('Created vehicle was not found');
    }

    approvedVehicle.verificationStatus = 'approved';
    approvedVehicle.isActive = true;

    const listedFleet = (
      await request(app)
        .get(`/vehicles?driverProfileId=${driverProfileId}`)
        .set('authorization', `Bearer ${token}`)
    ).body.data;

    expect(listedFleet).toHaveLength(2);

    const updated = await request(app)
      .patch(`/vehicles/${id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ color: 'Blue' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.color).toBe('Blue');

    const deactivated = await request(app)
      .post(`/vehicles/${id}/deactivate`)
      .set('authorization', `Bearer ${token}`)
      .send({});

    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);

    const finalFleet = (
      await request(app)
        .get(`/vehicles?driverProfileId=${driverProfileId}`)
        .set('authorization', `Bearer ${token}`)
    ).body.data;

    expect(finalFleet).toHaveLength(1);
  });

  it('handles validation, conflicts, and missing driver profiles', async () => {
    const app = createApp(undefined, undefined, new InMemoryVehicleRepository());

    const token = await getAuthToken();

    expect(
      (
        await request(app)
          .post('/vehicles')
          .set('authorization', `Bearer ${token}`)
          .send({ driverProfileId: 'bad' })
      ).status,
    ).toBe(400);

    const duplicate = await request(app)
      .post('/vehicles')
      .set('authorization', `Bearer ${token}`)
      .send({
        driverProfileId,
        make: 'Ford',
        model: 'Ecosport',
        plateNumber: vehicle.plateNumber,
      });

    expect(duplicate.status).toBe(409);

    const missing = await request(app)
      .get('/vehicles?driverProfileId=950e8400-e29b-41d4-a716-446655440000')
      .set('authorization', `Bearer ${token}`);

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('DRIVER_PROFILE_NOT_FOUND');
  });

  it('rejects an invalid vehicle ID', async () => {
    const app = createApp(undefined, undefined, new InMemoryVehicleRepository());

    const token = await getAuthToken();

    const response = await request(app)
      .get('/vehicles/not-a-valid-uuid')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent vehicle', async () => {
    const app = createApp(undefined, undefined, new InMemoryVehicleRepository());

    const token = await getAuthToken();

    const response = await request(app)
      .get('/vehicles/950e8400-e29b-41d4-a716-446655440000')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('VEHICLE_NOT_FOUND');
  });

  it('rejects an empty vehicle update', async () => {
    const app = createApp(undefined, undefined, new InMemoryVehicleRepository());

    const token = await getAuthToken();

    const response = await request(app)
      .patch(`/vehicles/${vehicle.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('rejects unexpected vehicle fields', async () => {
    const app = createApp(undefined, undefined, new InMemoryVehicleRepository());

    const token = await getAuthToken();

    const response = await request(app)
      .patch(`/vehicles/${vehicle.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({
        make: 'Honda',
        passwordHash: 'unexpected',
      });

    expect(response.status).toBe(400);
  });
});
