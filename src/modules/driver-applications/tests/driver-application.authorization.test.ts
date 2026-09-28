import { describe, expect, it, vi } from 'vitest';

import { DriverApplicationService } from '../driver-application.service.js';

import type { DriverApplicationRepository } from '../driver-application.repository.js';

import type {
  CreateDriverApplicationInput,
  DriverApplication,
  DriverApplicationFilters,
} from '../driver-application.types.js';

import type { PartnerDriverRepository } from '../../partners/repositories/partner-driver.repository.js';

import type { PartnerRepository } from '../../partners/repositories/partner.repository.js';

import type { DriverRepository } from '../../rides/repositories/driver.repository.js';

import type { AuthenticatedUser } from '../../auth/types/auth.js';

const partnerId = '550e8400-e29b-41d4-a716-446655440000';

const secondPartnerId = '650e8400-e29b-41d4-a716-446655440000';

const driverId = '750e8400-e29b-41d4-a716-446655440000';

const secondDriverId = '850e8400-e29b-41d4-a716-446655440000';

const applicationId = '950e8400-e29b-41d4-a716-446655440000';

const partnerUserId = '150e8400-e29b-41d4-a716-446655440000';

const secondPartnerUserId = '250e8400-e29b-41d4-a716-446655440000';

const driverUserId = '350e8400-e29b-41d4-a716-446655440000';

const secondDriverUserId = '450e8400-e29b-41d4-a716-446655440000';

const unrelatedUserId = '550e8400-e29b-41d4-a716-446655440001';

const adminUserId = '650e8400-e29b-41d4-a716-446655440001';

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

    findByDriverProfileId: vi.fn().mockResolvedValue(null),

    list: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    }),

    updateStatus: vi.fn().mockResolvedValue(
      application({
        status: 'APPROVED',
        approvedBy: adminUserId,
        approvedAt: new Date('2026-01-02'),
      }),
    ),
  };
}

function partnerDriverRepository(): PartnerDriverRepository {
  return {
    create: vi.fn().mockResolvedValue(null),

    findById: vi.fn().mockResolvedValue(null),

    findByPartnerAndDriver: vi.fn().mockResolvedValue(null),

    listByPartner: vi.fn().mockResolvedValue([]),

    listByDriver: vi.fn().mockResolvedValue([]),

    updateStatus: vi.fn().mockResolvedValue(null),
  };
}

function partnerRepository(): PartnerRepository {
  return {
    findByUserId: vi.fn().mockImplementation(async (userId: string) => {
      if (userId === partnerUserId) {
        return {
          id: partnerId,
          approvalStatus: 'approved',
        };
      }

      if (userId === secondPartnerUserId) {
        return {
          id: secondPartnerId,
          approvalStatus: 'approved',
        };
      }

      return null;
    }),

    findById: vi.fn().mockImplementation(async (id: string) => {
      if (id === partnerId) {
        return {
          id: partnerId,
          approvalStatus: 'approved',
        };
      }

      if (id === secondPartnerId) {
        return {
          id: secondPartnerId,
          approvalStatus: 'approved',
        };
      }

      return null;
    }),
  } as unknown as PartnerRepository;
}

function driverRepository(): DriverRepository {
  return {
    findProfileIdByUserId: vi.fn().mockImplementation(async (userId: string) => {
      if (userId === driverUserId) {
        return driverId;
      }

      if (userId === secondDriverUserId) {
        return secondDriverId;
      }

      return null;
    }),

    findProfileById: vi.fn().mockImplementation(async (profileId: string) => {
      if (profileId === driverId) {
        return {
          id: driverId,
          userId: driverUserId,
        };
      }

      if (profileId === secondDriverId) {
        return {
          id: secondDriverId,
          userId: secondDriverUserId,
        };
      }

      return null;
    }),
  } as unknown as DriverRepository;
}

function createService(repositoryOverride?: DriverApplicationRepository) {
  return new DriverApplicationService(
    repositoryOverride ?? repository(),
    partnerDriverRepository(),
    partnerRepository(),
    driverRepository(),
  );
}

function createInput(
  overrides: Partial<CreateDriverApplicationInput> = {},
): CreateDriverApplicationInput {
  return {
    partnerId,
    driverProfileId: driverId,
    requestedSector: 'passenger',
    requestedVehicleCategory: 'SEDAN',
    vehicleOwnershipType: 'PARTNER_OWNED',
    ...overrides,
  };
}

const partnerActor: AuthenticatedUser = {
  userId: partnerUserId,
  role: 'fleet_owner',
};

const driverActor: AuthenticatedUser = {
  userId: driverUserId,
  role: 'driver',
};

const unrelatedActor: AuthenticatedUser = {
  userId: unrelatedUserId,
  role: 'user',
};

const adminActor: AuthenticatedUser = {
  userId: adminUserId,
  role: 'admin',
};

const superAdminActor: AuthenticatedUser = {
  userId: adminUserId,
  role: 'super_admin',
};

describe('DriverApplicationService - Authorization', () => {
  describe('create', () => {
    it('allows a partner to create an application for its own partner profile', async () => {
      const repo = repository();
      const service = createService(repo);

      const input = createInput();

      await expect(service.create(partnerActor, input)).resolves.toBeDefined();

      expect(repo.create).toHaveBeenCalledWith(input);
    });

    it('rejects a partner from creating an application for another partner', async () => {
      const repo = repository();
      const service = createService(repo);

      const input = createInput({
        partnerId: secondPartnerId,
        driverProfileId: secondDriverId,
      });

      await expect(service.create(partnerActor, input)).rejects.toThrow(
        'You do not have permission to create this driver application.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('allows a driver to create an application for its own driver profile', async () => {
      const repo = repository();
      const service = createService(repo);

      const input = createInput({
        driverProfileId: driverId,
      });

      await expect(service.create(driverActor, input)).resolves.toBeDefined();

      expect(repo.create).toHaveBeenCalledWith(input);
    });

    it('rejects an unrelated user from creating a driver application', async () => {
      const repo = repository();
      const service = createService(repo);

      await expect(service.create(unrelatedActor, createInput())).rejects.toThrow(
        'You do not have permission to create this driver application.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects an admin from creating a driver application', async () => {
      const repo = repository();
      const service = createService(repo);

      const input = createInput({
        partnerId: secondPartnerId,
        driverProfileId: secondDriverId,
      });

      await expect(service.create(adminActor, input)).rejects.toThrow(
        'Admin and Super Admin cannot create driver applications.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a super admin from creating a driver application', async () => {
      const repo = repository();
      const service = createService(repo);

      const input = createInput({
        partnerId: secondPartnerId,
        driverProfileId: secondDriverId,
      });

      await expect(service.create(superAdminActor, input)).rejects.toThrow(
        'Admin and Super Admin cannot create driver applications.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('allows a partner to access its own application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getById(partnerActor, applicationId)).resolves.toMatchObject({
        id: applicationId,
        partnerId,
      });
    });

    it('rejects a partner from accessing another partner application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getById(partnerActor, applicationId)).rejects.toThrow(
        'You do not have access to this driver application.',
      );
    });

    it('allows a driver to access its own application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: driverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getById(driverActor, applicationId)).resolves.toMatchObject({
        id: applicationId,
        driverProfileId: driverId,
      });
    });

    it('rejects a driver from accessing another driver application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getById(driverActor, applicationId)).rejects.toThrow(
        'You do not have access to this driver application.',
      );
    });

    it('rejects an unrelated user from accessing an application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(application());

      const service = createService(repo);

      await expect(service.getById(unrelatedActor, applicationId)).rejects.toThrow(
        'You do not have access to this driver application.',
      );
    });

    it('allows an admin to access any application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getById(adminActor, applicationId)).resolves.toBeDefined();
    });

    it('allows a super admin to access any application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getById(superAdminActor, applicationId)).resolves.toBeDefined();
    });
  });

  describe('getByDriverProfileId', () => {
    it('allows a driver to access its own application', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: driverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getByDriverProfileId(driverActor, driverId)).resolves.toMatchObject({
        driverProfileId: driverId,
      });
    });

    it('rejects a driver from accessing another driver profile application', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getByDriverProfileId(driverActor, secondDriverId)).rejects.toThrow(
        'You do not have access to this driver application.',
      );
    });

    it('allows a partner to access an application belonging to its partner', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          partnerId,
          driverProfileId: driverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getByDriverProfileId(partnerActor, driverId)).resolves.toMatchObject({
        partnerId,
        driverProfileId: driverId,
      });
    });

    it('rejects a partner from accessing another partner application through driver profile lookup', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: driverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getByDriverProfileId(partnerActor, driverId)).rejects.toThrow(
        'You do not have access to this driver application.',
      );
    });

    it('allows an admin to access any driver application by driver profile', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: secondDriverId,
        }),
      );

      const service = createService(repo);

      await expect(service.getByDriverProfileId(adminActor, secondDriverId)).resolves.toBeDefined();
    });
  });

  describe('list', () => {
    it('scopes partner listing to its own partner ID and removes driver profile filter', async () => {
      const repo = repository();
      const service = createService(repo);

      const filters: DriverApplicationFilters = {
        status: 'PENDING',
        partnerId: secondPartnerId,
        driverProfileId: secondDriverId,
      };

      await service.list(partnerActor, filters);

      expect(repo.list).toHaveBeenCalledWith({
        status: 'PENDING',
        partnerId,
      });
    });

    it('scopes driver listing to its own driver profile ID and removes partner filter', async () => {
      const repo = repository();
      const service = createService(repo);

      const filters: DriverApplicationFilters = {
        status: 'PENDING',
        partnerId: secondPartnerId,
        driverProfileId: secondDriverId,
      };

      await service.list(driverActor, filters);

      expect(repo.list).toHaveBeenCalledWith({
        status: 'PENDING',
        driverProfileId: driverId,
      });
    });

    it('rejects an unrelated user from listing applications', async () => {
      const repo = repository();
      const service = createService(repo);

      await expect(service.list(unrelatedActor, {})).rejects.toThrow(
        'You do not have permission to view driver applications.',
      );

      expect(repo.list).not.toHaveBeenCalled();
    });

    it('allows an admin to list applications globally', async () => {
      const repo = repository();
      const service = createService(repo);

      const filters: DriverApplicationFilters = {
        partnerId: secondPartnerId,
        driverProfileId: secondDriverId,
        status: 'PENDING',
      };

      await service.list(adminActor, filters);

      expect(repo.list).toHaveBeenCalledWith(filters);
    });

    it('allows a super admin to list applications globally', async () => {
      const repo = repository();
      const service = createService(repo);

      const filters: DriverApplicationFilters = {
        partnerId: secondPartnerId,
        driverProfileId: secondDriverId,
        status: 'PENDING',
      };

      await service.list(superAdminActor, filters);

      expect(repo.list).toHaveBeenCalledWith(filters);
    });
  });
});
