import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type {
  CustomerFleetVehicle,
  VehicleRepository,
} from '../repositories/vehicle.repository.js';
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
      ownerId: 'owner-1',
      make: 'Toyota',
      model: 'Innova',
      color: 'Silver',
      plateNumber: 'KA-01-AB-1234',
      sector: 'passenger',
      category: 'suv',
      fuelRatePerKm: 0,
      loadCapacityKg: 0,
      manufacturingYear: 2022,
      fuelType: 'petrol',
      seatingCapacity: 7,
      registrationDate: new Date('2022-01-15'),
      registrationExpiry: new Date('2037-01-14'),
      isCommercial: true,
      permitDetails: null,
      verificationStatus: 'approved',
      isActive: true,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'veh-2',
      driverProfileId: 'driver-prof-2',
      ownerId: 'owner-2',
      make: 'Toyota',
      model: 'Fortuner',
      color: 'Black',
      plateNumber: 'KA-02-CD-5678',
      sector: 'premium',
      category: 'fortuner',
      fuelRatePerKm: 16,
      loadCapacityKg: 0,
      manufacturingYear: 2023,
      fuelType: 'diesel',
      seatingCapacity: 7,
      registrationDate: new Date('2023-02-10'),
      registrationExpiry: new Date('2038-02-09'),
      isCommercial: true,
      permitDetails: null,
      verificationStatus: 'approved',
      isActive: true,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'veh-3',
      driverProfileId: 'driver-prof-3',
      ownerId: 'owner-3',
      make: 'Tata',
      model: 'Ace',
      color: 'White',
      plateNumber: 'KA-03-EF-9012',
      sector: 'logistics',
      category: 'mini_truck',
      fuelRatePerKm: 0,
      loadCapacityKg: 1000,
      manufacturingYear: 2021,
      fuelType: 'diesel',
      seatingCapacity: 2,
      registrationDate: new Date('2021-03-20'),
      registrationExpiry: new Date('2036-03-19'),
      isCommercial: true,
      permitDetails: null,
      verificationStatus: 'approved',
      isActive: true,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'veh-4-retired',
      driverProfileId: 'driver-prof-4',
      ownerId: 'owner-4',
      make: 'Honda',
      model: 'City',
      color: 'Red',
      plateNumber: 'KA-04-GH-3456',
      sector: 'passenger',
      category: 'sedan',
      fuelRatePerKm: 0,
      loadCapacityKg: 0,
      manufacturingYear: 2020,
      fuelType: 'petrol',
      seatingCapacity: 5,
      registrationDate: new Date('2020-04-10'),
      registrationExpiry: new Date('2035-04-09'),
      isCommercial: true,
      permitDetails: null,
      verificationStatus: 'approved',
      isActive: false,
      retiredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'veh-5-pending',
      driverProfileId: 'driver-prof-5',
      ownerId: 'owner-5',
      make: 'Maruti',
      model: 'Ertiga',
      color: 'White',
      plateNumber: 'KA-05-IJ-7890',
      sector: 'passenger',
      category: 'mpv',
      fuelRatePerKm: 0,
      loadCapacityKg: 0,
      manufacturingYear: 2024,
      fuelType: 'petrol',
      seatingCapacity: 7,
      registrationDate: new Date('2024-05-10'),
      registrationExpiry: new Date('2039-05-09'),
      isCommercial: true,
      permitDetails: null,
      verificationStatus: 'pending',
      isActive: true,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  class FleetMockRepository implements VehicleRepository {
    async driverProfileExists(_id: string): Promise<boolean> {
      return true;
    }

    async create(_data: CreateVehicleData): Promise<Vehicle> {
      throw new Error('Not implemented');
    }

    async findById(id: string): Promise<Vehicle | null> {
      return mockVehicles.find((vehicle) => vehicle.id === id) ?? null;
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
          (vehicle) =>
            vehicle.isActive &&
            vehicle.verificationStatus === 'approved' &&
            (!sector || vehicle.sector === sector) &&
            (!category || vehicle.category === category),
        )
        .map((vehicle) => ({
          id: vehicle.id,
          make: vehicle.make,
          model: vehicle.model,
          color: vehicle.color,
          sector: vehicle.sector,
          category: vehicle.category,
          fuelRatePerKm: vehicle.fuelRatePerKm,
          loadCapacityKg: vehicle.loadCapacityKg,
        }));
    }
  }

  const app = createApp(undefined, undefined, new FleetMockRepository());

  it('rejects unauthenticated requests to /vehicles/fleet with 401', async () => {
    const res = await request(app).get('/vehicles/fleet');

    expect(res.status).toBe(401);
  });

  it('returns only active and approved customer fleet without exposing driverProfileId or plateNumber', async () => {
    const token = await getCustomerToken();

    const res = await request(app).get('/vehicles/fleet').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(res.body.data.length).toBe(3);

    const first = res.body.data[0];

    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('make');
    expect(first).toHaveProperty('model');
    expect(first).toHaveProperty('sector');
    expect(first).toHaveProperty('category');

    expect(first).not.toHaveProperty('driverProfileId');
    expect(first).not.toHaveProperty('plateNumber');
    expect(first).not.toHaveProperty('verificationStatus');
  });

  it('excludes pending vehicles from the customer fleet', async () => {
    const token = await getCustomerToken();

    const res = await request(app).get('/vehicles/fleet').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const vehicleIds = res.body.data.map((vehicle: { id: string }) => vehicle.id);

    expect(vehicleIds).not.toContain('veh-5-pending');
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
