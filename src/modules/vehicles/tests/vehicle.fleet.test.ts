import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { CustomerFleetVehicle, VehicleRepository } from '../repositories/vehicle.repository.js';
import type { CreateVehicleData, UpdateVehicleData, Vehicle } from '../types/vehicle.js';

describe('Vehicles Fleet API (Customer-Facing Read-Only)', () => {
  const customerUserId = '111e8400-e29b-41d4-a716-446655440001';
  const getCustomerToken = () =>
    signAccessToken({
      sub: customerUserId,
      role: 'customer',
      type: 'access',
    });

  const mockVehicles: Vehicle[] = [
    {
      id: 'veh-1',
      driverProfileId: 'driver-prof-1',
      make: 'Toyota',
      model: 'Innova',
      color: 'Silver',
      plateNumber: 'KA-01-AB-1234',
      sector: 'passenger',
      category: 'suv',
      fuelRatePerKm: 0,
      loadCapacityKg: 0,
      isActive: true,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'veh-2',
      driverProfileId: 'driver-prof-2',
      make: 'Toyota',
      model: 'Fortuner',
      color: 'Black',
      plateNumber: 'KA-02-CD-5678',
      sector: 'premium',
      category: 'fortuner',
      fuelRatePerKm: 16,
      loadCapacityKg: 0,
      isActive: true,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'veh-3',
      driverProfileId: 'driver-prof-3',
      make: 'Tata',
      model: 'Ace',
      color: 'White',
      plateNumber: 'KA-03-EF-9012',
      sector: 'logistics',
      category: 'mini_truck',
      fuelRatePerKm: 0,
      loadCapacityKg: 1000,
      isActive: true,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'veh-4-retired',
      driverProfileId: 'driver-prof-4',
      make: 'Honda',
      model: 'City',
      color: 'Red',
      plateNumber: 'KA-04-GH-3456',
      sector: 'passenger',
      category: 'sedan',
      fuelRatePerKm: 0,
      loadCapacityKg: 0,
      isActive: false,
      retiredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  class FleetMockRepository implements VehicleRepository {
    async driverProfileExists(_id: string) {
      return true;
    }
    async create(_data: CreateVehicleData): Promise<Vehicle> {
      throw new Error('Not implemented');
    }
    async findById(id: string): Promise<Vehicle | null> {
      return mockVehicles.find((v) => v.id === id) ?? null;
    }
    async findByDriver(_driverId: string, _activeOnly: boolean): Promise<Vehicle[]> {
      return [];
    }
    async update(_id: string, _data: UpdateVehicleData): Promise<Vehicle | null> {
      return null;
    }
    async deactivate(_id: string, _retiredAt: Date): Promise<Vehicle | null> {
      return null;
    }
    async listFleet(sector?: string, category?: string): Promise<CustomerFleetVehicle[]> {
      return mockVehicles
        .filter(
          (v) =>
            v.isActive &&
            (!sector || v.sector === sector) &&
            (!category || v.category === category),
        )
        .map((v) => ({
          id: v.id,
          make: v.make,
          model: v.model,
          color: v.color,
          sector: v.sector,
          category: v.category,
          fuelRatePerKm: v.fuelRatePerKm,
          loadCapacityKg: v.loadCapacityKg,
        }));
    }
  }

  const app = createApp(undefined, undefined, new FleetMockRepository());

  it('rejects unauthenticated requests to /vehicles/fleet with 401', async () => {
    const res = await request(app).get('/vehicles/fleet');
    expect(res.status).toBe(401);
  });

  it('returns active customer fleet without exposing driverProfileId or plateNumber', async () => {
    const token = await getCustomerToken();
    const res = await request(app)
      .get('/vehicles/fleet')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(3); // excludes inactive veh-4-retired

    const first = res.body.data[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('make');
    expect(first).toHaveProperty('model');
    expect(first).toHaveProperty('sector');
    expect(first).toHaveProperty('category');
    expect(first).not.toHaveProperty('driverProfileId');
    expect(first).not.toHaveProperty('plateNumber');
  });

  it('filters customer fleet by sector', async () => {
    const token = await getCustomerToken();
    const res = await request(app)
      .get('/vehicles/fleet?sector=premium')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].category).toBe('fortuner');
    expect(res.body.data[0].fuelRatePerKm).toBe(16);
  });

  it('filters customer fleet by category', async () => {
    const token = await getCustomerToken();
    const res = await request(app)
      .get('/vehicles/fleet?sector=logistics&category=mini_truck')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].loadCapacityKg).toBe(1000);
  });
});
