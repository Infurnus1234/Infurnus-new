import { describe, expect, it, vi } from 'vitest';

import { DriverApplicationService } from '../driver-application.service.js';
import type { DriverApplicationRepository } from '../driver-application.repository.js';
import type { DriverApplication, DriverApplicationFilters } from '../driver-application.types.js';

import type { PartnerDriverRepository } from '../../partners/repositories/partner-driver.repository.js';

import type { PartnerRepository } from '../../partners/repositories/partner.repository.js';

import type { DriverRepository } from '../../rides/repositories/driver.repository.js';

import type { AuthenticatedUser } from '../../auth/types/auth.js';

const partnerId = '550e8400-e29b-41d4-a716-446655440000';

const secondPartnerId = '650e8400-e29b-41d4-a716-446655440000';

const driverId = '750e8400-e29b-41d4-a716-446655440000';

const secondDriverId = '850e8400-e29b-41d4-a716-446655440000';

const applicationId = '950e8400-e29b-41d4-a716-446655440000';

function application(overrides: Partial<DriverApplication> = {}): DriverApplication {
  return {
    id: applicationId,
    partnerId,
    driverProfileId: driverId,
    requestedSector: 'passenger',
    requestedVehicleCategory: 'SEDAN',
    vehicleOwnershipType: 'PARTNER_OWNED',
    status: 'PENDING',
    submittedAt: new Date('2026-01-01'),
    reviewedAt: null,
    reviewedBy: null,
    reviewReason: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function repository(): DriverApplicationRepository {
  return {
    create: vi.fn().mockResolvedValue(application()),

    findById: vi.fn().mockResolvedValue(application()),

    findActiveByPartnerAndDriver: vi.fn().mockResolvedValue(null),

    findByDriverProfileId: vi.fn().mockResolvedValue(application()),

    list: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
    }),

    updateStatus: vi.fn().mockResolvedValue(null),
  };
}

function partnerRepository(): PartnerRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),

    findByUserId: vi.fn().mockResolvedValue(null),
  } as unknown as PartnerRepository;
}

function driverRepository(): DriverRepository {
  return {
    findProfileById: vi.fn().mockResolvedValue(null),

    findProfileIdByUserId: vi.fn().mockResolvedValue(null),
  } as unknown as DriverRepository;
}

function partnerDriverRepository(): PartnerDriverRepository {
  return {
    create: vi.fn(),

    findById: vi.fn().mockResolvedValue(null),

    findByPartnerAndDriver: vi.fn().mockResolvedValue(null),

    listByPartner: vi.fn().mockResolvedValue([]),

    listByDriver: vi.fn().mockResolvedValue([]),

    updateStatus: vi.fn(),
  };
}

function service(
  repo: DriverApplicationRepository,
  partnerRepo: PartnerRepository,
  driverRepo: DriverRepository,
): DriverApplicationService {
  return new DriverApplicationService(repo, partnerDriverRepository(), partnerRepo, driverRepo);
}

function user(
  role: 'customer' | 'driver' | 'fleet_owner' | 'driver_fleet_owner' | 'admin' | 'super_admin',
  userId: string,
): AuthenticatedUser {
  return {
    userId,
    role,
  } as AuthenticatedUser;
}

describe('DriverApplicationService - Access Isolation', () => {
  describe('getById', () => {
    it('rejects Driver A from accessing Driver B application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          driverProfileId: secondDriverId,
        }),
      );

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(driverId);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const driverA = user('driver', 'driver-a-user-id');

      await expect(serviceInstance.getById(driverA, applicationId)).rejects.toThrow(
        'You do not have access to this driver application.',
      );
    });

    it('rejects Fleet Owner A from accessing Partner B application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue({
        id: partnerId,
      } as never);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(null);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const fleetOwnerA = user('fleet_owner', 'fleet-owner-a-user-id');

      await expect(serviceInstance.getById(fleetOwnerA, applicationId)).rejects.toThrow(
        'You do not have access to this driver application.',
      );
    });

    it('allows Fleet Owner A to access its own Partner application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue({
        id: partnerId,
      } as never);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(null);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const fleetOwnerA = user('fleet_owner', 'fleet-owner-a-user-id');

      await expect(serviceInstance.getById(fleetOwnerA, applicationId)).resolves.toMatchObject({
        partnerId,
      });
    });

    it('allows Driver A to access their own application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: driverId,
        }),
      );

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue(null);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(driverId);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const driverA = user('driver', 'driver-a-user-id');

      await expect(serviceInstance.getById(driverA, applicationId)).resolves.toMatchObject({
        driverProfileId: driverId,
      });
    });
  });

  describe('getByDriverProfileId', () => {
    it('rejects Driver A from accessing Driver B application', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          driverProfileId: secondDriverId,
        }),
      );

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(driverId);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const driverA = user('driver', 'driver-a-user-id');

      await expect(serviceInstance.getByDriverProfileId(driverA, secondDriverId)).rejects.toThrow(
        'You do not have access to this driver application.',
      );
    });

    it('allows Driver A to access their own driver application', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          driverProfileId: driverId,
        }),
      );

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(driverId);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const driverA = user('driver', 'driver-a-user-id');

      await expect(serviceInstance.getByDriverProfileId(driverA, driverId)).resolves.toMatchObject({
        driverProfileId: driverId,
      });
    });
  });

  describe('list', () => {
    it('scopes Fleet Owner A to its own Partner', async () => {
      const repo = repository();

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue({
        id: partnerId,
      } as never);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(null);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const fleetOwnerA = user('fleet_owner', 'fleet-owner-a-user-id');

      const filters: DriverApplicationFilters = {
        page: 1,
        limit: 20,
      };

      await serviceInstance.list(fleetOwnerA, filters);

      expect(repo.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        partnerId,
      });
    });

    it('does not allow Fleet Owner A to override its Partner scope', async () => {
      const repo = repository();

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue({
        id: partnerId,
      } as never);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(null);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const fleetOwnerA = user('fleet_owner', 'fleet-owner-a-user-id');

      const filters: DriverApplicationFilters = {
        page: 1,
        limit: 20,
        partnerId: secondPartnerId,
      };

      await serviceInstance.list(fleetOwnerA, filters);

      expect(repo.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        partnerId,
      });

      expect(repo.list).not.toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: secondPartnerId,
        }),
      );
    });

    it('scopes Driver A to their own driver profile', async () => {
      const repo = repository();

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue(null);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(driverId);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const driverA = user('driver', 'driver-a-user-id');

      const filters: DriverApplicationFilters = {
        page: 1,
        limit: 20,
      };

      await serviceInstance.list(driverA, filters);

      expect(repo.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        driverProfileId: driverId,
      });
    });

    it('does not allow Driver A to override their driver scope', async () => {
      const repo = repository();

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue(null);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(driverId);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const driverA = user('driver', 'driver-a-user-id');

      const filters: DriverApplicationFilters = {
        page: 1,
        limit: 20,
        driverProfileId: secondDriverId,
      };

      await serviceInstance.list(driverA, filters);

      expect(repo.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        driverProfileId: driverId,
      });

      expect(repo.list).not.toHaveBeenCalledWith(
        expect.objectContaining({
          driverProfileId: secondDriverId,
        }),
      );
    });

    it('scopes Driver + Fleet Owner to its own Partner', async () => {
      const repo = repository();

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue({
        id: partnerId,
      } as never);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(driverId);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const driverFleetOwner = user('driver_fleet_owner', 'driver-fleet-owner-user-id');

      const filters: DriverApplicationFilters = {
        page: 1,
        limit: 20,
        driverProfileId: secondDriverId,
      };

      await serviceInstance.list(driverFleetOwner, filters);

      expect(repo.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        partnerId,
      });

      expect(repo.list).not.toHaveBeenCalledWith(
        expect.objectContaining({
          driverProfileId: secondDriverId,
        }),
      );
    });

    it('rejects a user with no Partner or Driver ownership', async () => {
      const repo = repository();

      const partnerRepo = partnerRepository();
      const driverRepo = driverRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue(null);

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(null);

      const serviceInstance = service(repo, partnerRepo, driverRepo);

      const customer = user('customer', 'customer-user-id');

      await expect(
        serviceInstance.list(customer, {
          page: 1,
          limit: 20,
        }),
      ).rejects.toThrow('You do not have permission to view driver applications.');
    });
  });
});
