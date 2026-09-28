import { describe, expect, it, vi } from 'vitest';

import { PartnerVehicleService } from '../services/partner-vehicle.service.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';
import type { Partner } from '../types/partner.js';
import type { FleetService } from '../../fleet/services/fleet.service.js';

const ownerId = '550e8400-e29b-41d4-a716-446655440000';
const outsiderId = '850e8400-e29b-41d4-a716-446655440000';
const adminId = '750e8400-e29b-41d4-a716-446655440000';

const partner: Partner = {
  id: '650e8400-e29b-41d4-a716-446655440000',
  userId: ownerId,
  businessName: 'Ada Transport',
  businessDescription: null,
  approvalStatus: 'approved',
  availabilityStatus: 'offline',
  reviewedAt: new Date('2026-01-02'),
  reviewedBy: adminId,
  approvedAt: new Date('2026-01-02'),
  approvedBy: adminId,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const actor = {
  userId: ownerId,
  role: 'customer',
} as const;

const outsider = {
  userId: outsiderId,
  role: 'customer',
} as const;

function partnerRepository(currentPartner: Partner | null = partner): PartnerRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByUserId: vi.fn().mockResolvedValue(currentPartner),
    findAll: vi.fn(),
    update: vi.fn(),
    review: vi.fn(),
  };
}

function fleetService(): FleetService {
  return {
    listVehicles: vi.fn().mockResolvedValue([]),
    createVehicle: vi.fn().mockResolvedValue({
      id: '950e8400-e29b-41d4-a716-446655440000',
    }),
    updateVehicle: vi.fn().mockResolvedValue({
      id: '950e8400-e29b-41d4-a716-446655440000',
    }),
    deactivateVehicle: vi.fn().mockResolvedValue(true),
  } as unknown as FleetService;
}

const vehicleId = '950e8400-e29b-41d4-a716-446655440000';

const createVehicleInput = {
  registrationNumber: 'RJ14AB1234',
  vehicleType: 'SEDAN',
} as any;

const updateVehicleInput = {
  vehicleType: 'SUV',
} as any;

describe('PartnerVehicleService authorization and ownership matrix', () => {
  it('allows an approved partner to list only its own vehicles', async () => {
    const partnerRepo = partnerRepository();
    const fleet = fleetService();

    const service = new PartnerVehicleService(partnerRepo, fleet);

    await service.listVehicles(actor);

    expect(fleet.listVehicles).toHaveBeenCalledWith(ownerId);
  });

  it('allows an approved partner to create a vehicle under its own owner id', async () => {
    const partnerRepo = partnerRepository();
    const fleet = fleetService();

    const service = new PartnerVehicleService(partnerRepo, fleet);

    await service.createVehicle(actor, createVehicleInput);

    expect(fleet.createVehicle).toHaveBeenCalledWith(ownerId, createVehicleInput);
  });

  it('allows an approved partner to update only through its own owner id', async () => {
    const partnerRepo = partnerRepository();
    const fleet = fleetService();

    const service = new PartnerVehicleService(partnerRepo, fleet);

    await service.updateVehicle(actor, vehicleId, updateVehicleInput);

    expect(fleet.updateVehicle).toHaveBeenCalledWith(ownerId, vehicleId, updateVehicleInput);
  });

  it('allows an approved partner to deactivate only through its own owner id', async () => {
    const partnerRepo = partnerRepository();
    const fleet = fleetService();

    const service = new PartnerVehicleService(partnerRepo, fleet);

    await expect(service.deactivateVehicle(actor, vehicleId)).resolves.toEqual({ id: vehicleId });

    expect(fleet.deactivateVehicle).toHaveBeenCalledWith(ownerId, vehicleId);
  });

  it('rejects a user without a partner profile', async () => {
    const partnerRepo = partnerRepository(null);
    const fleet = fleetService();

    const service = new PartnerVehicleService(partnerRepo, fleet);

    await expect(service.listVehicles(outsider)).rejects.toMatchObject({
      code: 'PARTNER_NOT_FOUND',
      statusCode: 404,
    });

    expect(fleet.listVehicles).not.toHaveBeenCalled();
  });

  it('rejects an unapproved partner from vehicle management', async () => {
    const pendingPartner: Partner = {
      ...partner,
      approvalStatus: 'pending',
    };

    const partnerRepo = partnerRepository(pendingPartner);
    const fleet = fleetService();

    const service = new PartnerVehicleService(partnerRepo, fleet);

    await expect(service.listVehicles(actor)).rejects.toMatchObject({
      code: 'PARTNER_NOT_APPROVED',
      statusCode: 403,
    });

    expect(fleet.listVehicles).not.toHaveBeenCalled();
  });

  it('returns not found when deactivation finds no active vehicle', async () => {
    const partnerRepo = partnerRepository();
    const fleet = fleetService();

    vi.mocked(fleet.deactivateVehicle).mockResolvedValue(false);

    const service = new PartnerVehicleService(partnerRepo, fleet);

    await expect(service.deactivateVehicle(actor, vehicleId)).rejects.toMatchObject({
      code: 'VEHICLE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('never uses a caller-supplied owner id', async () => {
    const partnerRepo = partnerRepository();
    const fleet = fleetService();

    const service = new PartnerVehicleService(partnerRepo, fleet);

    await service.listVehicles(actor);

    expect(fleet.listVehicles).toHaveBeenCalledWith(partner.userId);
    expect(fleet.listVehicles).not.toHaveBeenCalledWith(outsiderId);
  });
});
