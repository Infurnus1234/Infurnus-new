import { describe, expect, it, vi } from 'vitest';

import type { AdminRepository } from '../repositories/admin.repository.js';
import { AdminService } from '../services/admin.service.js';

const repository = (overrides: Partial<AdminRepository> = {}): AdminRepository => ({
  listUsers: vi.fn().mockResolvedValue({
    items: [],
    page: 2,
    pageSize: 10,
    total: 0,
  }),

  listDrivers: vi.fn().mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  }),

  listDriverApplications: vi.fn().mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  }),

  getDriver: vi.fn().mockResolvedValue(null),

  getUser: vi.fn().mockResolvedValue(null),

  updateUserStatus: vi.fn().mockResolvedValue(null),

  listPartners: vi.fn().mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  }),

  getPartner: vi.fn().mockResolvedValue(null),

  listVehicles: vi.fn().mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  }),

  getVehicle: vi.fn().mockResolvedValue(null),

  dashboard: vi.fn().mockResolvedValue({}),

  verifyDriver: vi.fn().mockResolvedValue(true),

  verifyVehicle: vi.fn().mockResolvedValue(true),

  verifyDocument: vi.fn().mockResolvedValue(true),

  getFleetAnalyticsSummary: vi.fn().mockResolvedValue({
    totalVehicles: 0,
    activeVehicles: 0,
    onTripVehicles: 0,
    offlineVehicles: 0,
    activePercentage: 0,
  }),

  getStateFleetAnalytics: vi.fn().mockResolvedValue([]),

  getCityFleetAnalytics: vi.fn().mockResolvedValue([]),

  getLiveFleetVehicles: vi.fn().mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  }),

  getLiveFleetVehicleDetails: vi.fn().mockResolvedValue(null),

  ...overrides,
});

describe('AdminService', () => {
  it('passes validated pagination and filters to the repository', async () => {
    const listUsers = vi.fn().mockResolvedValue({
      items: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });

    const service = new AdminService(repository({ listUsers }));

    const filters = {
      page: 2,
      pageSize: 10,
      search: 'Ada',
      role: 'driver' as const,
    };

    await expect(service.listUsers(filters)).resolves.toEqual({
      items: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });

    expect(listUsers).toHaveBeenCalledWith(filters);
  });

  it('passes driver filters to the repository', async () => {
    const listDrivers = vi.fn().mockResolvedValue({
      items: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });

    const service = new AdminService(repository({ listDrivers }));

    const filters = {
      page: 2,
      pageSize: 10,
      search: 'Rahul',
      verificationStatus: 'pending' as const,
      availabilityStatus: 'available' as const,
      partnerId: '550e8400-e29b-41d4-a716-446655440000',
      city: 'Jaipur',
      state: 'Rajasthan',
    };

    await expect(service.listDrivers(filters)).resolves.toEqual({
      items: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });

    expect(listDrivers).toHaveBeenCalledWith(filters);
  });

  it('updates user status and returns the updated user', async () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';

    const updatedUser = {
      id: userId,
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      phone: '+919999999999',
      role: 'customer',
      status: 'suspended',
      createdAt: new Date(),
    };

    const updateUserStatus = vi.fn().mockResolvedValue(updatedUser);

    const service = new AdminService(
      repository({
        updateUserStatus,
      }),
    );

    await expect(service.updateUserStatus(userId, 'suspended')).resolves.toEqual(updatedUser);

    expect(updateUserStatus).toHaveBeenCalledWith(userId, 'suspended');
  });

  it('returns a not-found error when updating status for a missing user', async () => {
    const userId = '650e8400-e29b-41d4-a716-446655440001';

    const updateUserStatus = vi.fn().mockResolvedValue(null);

    const service = new AdminService(
      repository({
        updateUserStatus,
      }),
    );

    await expect(service.updateUserStatus(userId, 'suspended')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      statusCode: 404,
    });

    expect(updateUserStatus).toHaveBeenCalledWith(userId, 'suspended');
  });

  it('returns vehicle details when the vehicle exists', async () => {
    const vehicleId = '750e8400-e29b-41d4-a716-446655440000';

    const vehicle = {
      id: vehicleId,
    };

    const getVehicle = vi.fn().mockResolvedValue(vehicle);

    const service = new AdminService(
      repository({
        getVehicle,
      }),
    );

    await expect(service.getVehicle(vehicleId)).resolves.toEqual(vehicle);

    expect(getVehicle).toHaveBeenCalledWith(vehicleId);
  });

  it('verifies a vehicle and returns the verification result', async () => {
    const vehicleId = '850e8400-e29b-41d4-a716-446655440000';

    const verifyVehicle = vi.fn().mockResolvedValue(true);

    const service = new AdminService(
      repository({
        verifyVehicle,
      }),
    );

    await expect(service.verifyVehicle(vehicleId, 'APPROVED')).resolves.toEqual({
      success: true,
      vehicleId,
      status: 'APPROVED',
    });

    expect(verifyVehicle).toHaveBeenCalledWith(vehicleId, 'APPROVED', undefined);
  });

  it('passes rejection reason when rejecting a vehicle', async () => {
    const vehicleId = '950e8400-e29b-41d4-a716-446655440000';
    const rejectionReason = 'Vehicle documents are invalid';

    const verifyVehicle = vi.fn().mockResolvedValue(true);

    const service = new AdminService(
      repository({
        verifyVehicle,
      }),
    );

    await expect(service.verifyVehicle(vehicleId, 'REJECTED', rejectionReason)).resolves.toEqual({
      success: true,
      vehicleId,
      status: 'REJECTED',
    });

    expect(verifyVehicle).toHaveBeenCalledWith(vehicleId, 'REJECTED', rejectionReason);
  });

  it('returns a not-found error when verifying a missing vehicle', async () => {
    const vehicleId = 'a50e8400-e29b-41d4-a716-446655440000';

    const verifyVehicle = vi.fn().mockResolvedValue(false);

    const service = new AdminService(
      repository({
        verifyVehicle,
      }),
    );

    await expect(service.verifyVehicle(vehicleId, 'APPROVED')).rejects.toMatchObject({
      code: 'VEHICLE_NOT_FOUND',
      statusCode: 404,
    });

    expect(verifyVehicle).toHaveBeenCalledWith(vehicleId, 'APPROVED', undefined);
  });

  it('returns a not-found error for missing admin resources', async () => {
    const service = new AdminService(repository());

    await expect(service.getUser('550e8400-e29b-41d4-a716-446655440001')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      statusCode: 404,
    });

    await expect(service.getPartner('650e8400-e29b-41d4-a716-446655440001')).rejects.toMatchObject({
      code: 'PARTNER_NOT_FOUND',
      statusCode: 404,
    });

    await expect(service.getVehicle('750e8400-e29b-41d4-a716-446655440001')).rejects.toMatchObject({
      code: 'VEHICLE_NOT_FOUND',
      statusCode: 404,
    });

    await expect(
      service.getLiveFleetVehicleDetails('850e8400-e29b-41d4-a716-446655440001'),
    ).rejects.toMatchObject({
      code: 'VEHICLE_NOT_FOUND',
      statusCode: 404,
    });
  });
});
