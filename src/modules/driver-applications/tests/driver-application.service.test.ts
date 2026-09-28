import { describe, expect, it, vi } from 'vitest';

import { DriverApplicationService } from '../driver-application.service.js';
import type { DriverApplicationRepository } from '../driver-application.repository.js';
import type {
  CreateDriverApplicationInput,
  DriverApplication,
} from '../driver-application.types.js';

import type { PartnerDriverRepository } from '../../partners/repositories/partner-driver.repository.js';

import type { PartnerDriver } from '../../partners/types/partner-driver.js';

import type { PartnerRepository } from '../../partners/repositories/partner.repository.js';

import type { DriverRepository } from '../../rides/repositories/driver.repository.js';

import type { AuthenticatedUser } from '../../auth/types/auth.js';

const partnerId = '550e8400-e29b-41d4-a716-446655440000';

const secondPartnerId = '650e8400-e29b-41d4-a716-446655440000';

const driverId = '750e8400-e29b-41d4-a716-446655440000';

const secondDriverId = '850e8400-e29b-41d4-a716-446655440000';

const applicationId = '950e8400-e29b-41d4-a716-446655440000';

const relationshipId = 'a50e8400-e29b-41d4-a716-446655440000';

const partnerUserId = 'b50e8400-e29b-41d4-a716-446655440000';

const driverUserId = 'c50e8400-e29b-41d4-a716-446655440000';

const adminUserId = 'd50e8400-e29b-41d4-a716-446655440000';

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

function partnerDriver(overrides: Partial<PartnerDriver> = {}): PartnerDriver {
  return {
    id: relationshipId,
    partnerId,
    driverProfileId: driverId,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function repository(): DriverApplicationRepository {
  return {
    create: vi.fn().mockResolvedValue(application()),

    findById: vi.fn().mockResolvedValue(null),

    findActiveByPartnerAndDriver: vi.fn().mockResolvedValue(null),

    findByDriverProfileId: vi.fn().mockResolvedValue(null),

    list: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
    }),

    updateStatus: vi.fn().mockResolvedValue(null),
  };
}

function partnerDriverRepository(): PartnerDriverRepository {
  return {
    create: vi.fn().mockResolvedValue(partnerDriver()),

    findById: vi.fn().mockResolvedValue(null),

    findByPartnerAndDriver: vi.fn().mockResolvedValue(null),

    listByPartner: vi.fn().mockResolvedValue([]),

    listByDriver: vi.fn().mockResolvedValue([]),

    updateStatus: vi.fn().mockResolvedValue(null),
  };
}

function partnerRepository(): PartnerRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue({
      id: partnerId,
      approvalStatus: 'approved',
    }),

    findById: vi.fn().mockResolvedValue({
      id: partnerId,
      approvalStatus: 'approved',
    }),
  } as unknown as PartnerRepository;
}

function driverRepository(): DriverRepository {
  return {
    findProfileIdByUserId: vi.fn().mockResolvedValue(driverId),

    findProfileById: vi.fn().mockResolvedValue({
      id: driverId,
      userId: driverUserId,
    }),

    updateVerificationStatus: vi.fn().mockResolvedValue(true),
  } as unknown as DriverRepository;
}

const partnerActor: AuthenticatedUser = {
  userId: partnerUserId,
  role: 'fleet_owner',
};

const driverActor: AuthenticatedUser = {
  userId: driverUserId,
  role: 'driver',
};

const driverFleetOwnerActor: AuthenticatedUser = {
  userId: partnerUserId,
  role: 'driver_fleet_owner',
};

const adminActor: AuthenticatedUser = {
  userId: adminUserId,
  role: 'admin',
};

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

function createService(
  repositoryOverride?: DriverApplicationRepository,
  partnerDriverRepositoryOverride?: PartnerDriverRepository,
  partnerRepositoryOverride?: PartnerRepository,
  driverRepositoryOverride?: DriverRepository,
) {
  return new DriverApplicationService(
    repositoryOverride ?? repository(),
    partnerDriverRepositoryOverride ?? partnerDriverRepository(),
    partnerRepositoryOverride ?? partnerRepository(),
    driverRepositoryOverride ?? driverRepository(),
  );
}

describe('DriverApplicationService', () => {
  describe('create', () => {
    it('allows a partner to create an application for a driver', async () => {
      const repo = repository();

      const service = createService(repo);

      const input = createInput();

      await service.create(partnerActor, input);

      expect(repo.findActiveByPartnerAndDriver).toHaveBeenCalledWith(partnerId, driverId);

      expect(repo.create).toHaveBeenCalledWith(input);
    });

    it('allows the same partner to create applications for multiple drivers', async () => {
      const repo = repository();

      const service = createService(repo);

      const firstInput = createInput({
        driverProfileId: driverId,
      });

      const secondInput = createInput({
        driverProfileId: secondDriverId,
      });

      await service.create(partnerActor, firstInput);

      await service.create(partnerActor, secondInput);

      expect(repo.findActiveByPartnerAndDriver).toHaveBeenNthCalledWith(1, partnerId, driverId);

      expect(repo.findActiveByPartnerAndDriver).toHaveBeenNthCalledWith(
        2,
        partnerId,
        secondDriverId,
      );

      expect(repo.create).toHaveBeenNthCalledWith(1, firstInput);

      expect(repo.create).toHaveBeenNthCalledWith(2, secondInput);

      expect(repo.create).toHaveBeenCalledTimes(2);
    });

    it('rejects a duplicate active application for the same partner and driver', async () => {
      const repo = repository();

      vi.mocked(repo.findActiveByPartnerAndDriver).mockResolvedValue(
        application({
          partnerId,
          driverProfileId: driverId,
          status: 'PENDING',
        }),
      );

      const service = createService(repo);

      await expect(service.create(partnerActor, createInput())).rejects.toThrow(
        'An active driver application already exists for this partner and driver.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a driver who already has an active application', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: driverId,
          status: 'UNDER_REVIEW',
        }),
      );

      const service = createService(repo);

      await expect(service.create(partnerActor, createInput())).rejects.toThrow(
        'An active driver application already exists for this driver.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('allows a driver whose previous application is no longer active', async () => {
      const repo = repository();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(
        application({
          partnerId: secondPartnerId,
          driverProfileId: driverId,
          status: 'REJECTED',
        }),
      );

      const service = createService(repo);

      await expect(service.create(partnerActor, createInput())).resolves.toBeDefined();

      expect(repo.create).toHaveBeenCalledWith(createInput());
    });

    it('rejects an admin from creating a driver application', async () => {
      const repo = repository();

      const service = createService(repo);

      await expect(service.create(adminActor, createInput())).rejects.toThrow(
        'Admin and Super Admin cannot create driver applications.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a driver application when the partner is not approved', async () => {
      const repo = repository();

      const partnerRepo = partnerRepository();

      vi.mocked(partnerRepo.findById).mockResolvedValue({
        id: partnerId,
        approvalStatus: 'pending',
      } as never);

      const service = createService(repo, undefined, partnerRepo);

      await expect(service.create(partnerActor, createInput())).rejects.toThrow(
        'Partner must be approved before creating a driver application.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a driver application when the partner does not exist', async () => {
      const repo = repository();

      const partnerRepo = partnerRepository();

      vi.mocked(partnerRepo.findById).mockResolvedValue(null);

      const service = createService(repo, undefined, partnerRepo);

      await expect(service.create(partnerActor, createInput())).rejects.toThrow(
        'Partner not found.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a driver application when the driver profile does not exist', async () => {
      const repo = repository();

      const driverRepo = driverRepository();

      vi.mocked(driverRepo.findProfileById).mockResolvedValue(null);

      const service = createService(repo, undefined, undefined, driverRepo);

      await expect(service.create(partnerActor, createInput())).rejects.toThrow(
        'Driver profile not found.',
      );

      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns an existing application', async () => {
      const repo = repository();

      const expected = application();

      vi.mocked(repo.findById).mockResolvedValue(expected);

      const service = createService(repo);

      await expect(service.getById(partnerActor, applicationId)).resolves.toEqual(expected);
    });

    it('throws when application does not exist', async () => {
      const repo = repository();

      const service = createService(repo);

      await expect(service.getById(partnerActor, applicationId)).rejects.toThrow(
        'Driver application not found.',
      );
    });
  });

  describe('getByDriverProfileId', () => {
    it('returns the driver application', async () => {
      const repo = repository();

      const expected = application();

      vi.mocked(repo.findByDriverProfileId).mockResolvedValue(expected);

      const service = createService(repo);

      await expect(service.getByDriverProfileId(driverActor, driverId)).resolves.toEqual(expected);
    });

    it('throws when the driver has no application', async () => {
      const repo = repository();

      const service = createService(repo);

      await expect(service.getByDriverProfileId(driverActor, driverId)).rejects.toThrow(
        'Driver application not found.',
      );
    });
  });

  describe('list', () => {
    it('delegates filters to the repository for admin users', async () => {
      const repo = repository();

      const result = {
        items: [application()],
        total: 1,
      };

      vi.mocked(repo.list).mockResolvedValue(result);

      const service = createService(repo);

      const filters = {
        partnerId,
        driverProfileId: driverId,
        status: 'PENDING' as const,
      };

      await expect(service.list(adminActor, filters)).resolves.toEqual(result);

      expect(repo.list).toHaveBeenCalledWith(filters);
    });

    it('lists applications scoped to the fleet owner partner', async () => {
      const repo = repository();

      const result = {
        items: [
          application({
            partnerId,
            driverProfileId: driverId,
          }),
          application({
            id: 'a50e8400-e29b-41d4-a716-446655440000',
            partnerId,
            driverProfileId: secondDriverId,
          }),
        ],
        total: 2,
      };

      vi.mocked(repo.list).mockResolvedValue(result);

      const partnerRepo = partnerRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue({
        id: partnerId,
        approvalStatus: 'approved',
      } as never);

      const driverRepo = driverRepository();

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(null);

      const service = createService(repo, undefined, partnerRepo, driverRepo);

      await expect(
        service.list(partnerActor, {
          page: 1,
          limit: 20,
        }),
      ).resolves.toEqual(result);

      expect(repo.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        partnerId,
      });
    });

    it('lists all fleet applications using partner scope for a driver-fleet-owner', async () => {
      const repo = repository();

      const result = {
        items: [
          application({
            partnerId,
            driverProfileId: driverId,
          }),
          application({
            id: 'a50e8400-e29b-41d4-a716-446655440000',
            partnerId,
            driverProfileId: secondDriverId,
          }),
        ],
        total: 2,
      };

      vi.mocked(repo.list).mockResolvedValue(result);

      const partnerRepo = partnerRepository();

      vi.mocked(partnerRepo.findByUserId).mockResolvedValue({
        id: partnerId,
        approvalStatus: 'approved',
      } as never);

      const driverRepo = driverRepository();

      vi.mocked(driverRepo.findProfileIdByUserId).mockResolvedValue(driverId);

      const service = createService(repo, undefined, partnerRepo, driverRepo);

      await expect(
        service.list(driverFleetOwnerActor, {
          page: 1,
          limit: 20,
        }),
      ).resolves.toEqual(result);

      expect(repo.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        partnerId,
      });

      expect(repo.list).not.toHaveBeenCalledWith(
        expect.objectContaining({
          driverProfileId: driverId,
        }),
      );
    });
  });

  describe('review', () => {
    it('allows review of a pending application and creates the partner-driver relationship', async () => {
      const repo = repository();

      const relationshipRepo = partnerDriverRepository();

      const pendingApplication = application({
        status: 'PENDING',
      });

      const approvedApplication = application({
        status: 'APPROVED',
        reviewedBy: partnerId,
        approvedBy: partnerId,
        reviewedAt: new Date('2026-01-02'),
        approvedAt: new Date('2026-01-02'),
      });

      vi.mocked(repo.findById).mockResolvedValue(pendingApplication);

      vi.mocked(repo.updateStatus).mockResolvedValue(approvedApplication);

      const service = createService(repo, relationshipRepo);

      const review = {
        status: 'APPROVED' as const,
      };

      await expect(service.review(applicationId, review, partnerId)).resolves.toEqual(
        approvedApplication,
      );

      expect(repo.updateStatus).toHaveBeenCalledWith(applicationId, review, partnerId);

      expect(relationshipRepo.findByPartnerAndDriver).toHaveBeenCalledWith(partnerId, driverId);

      expect(relationshipRepo.create).toHaveBeenCalledWith({
        partnerId,
        driverProfileId: driverId,
      });
    });

    it('does not create a relationship when an active relationship already exists', async () => {
      const repo = repository();

      const relationshipRepo = partnerDriverRepository();

      const approvedApplication = application({
        status: 'APPROVED',
        reviewedBy: partnerId,
        approvedBy: partnerId,
        reviewedAt: new Date('2026-01-02'),
        approvedAt: new Date('2026-01-02'),
      });

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          status: 'PENDING',
        }),
      );

      vi.mocked(repo.updateStatus).mockResolvedValue(approvedApplication);

      vi.mocked(relationshipRepo.findByPartnerAndDriver).mockResolvedValue(
        partnerDriver({
          status: 'ACTIVE',
        }),
      );

      const service = createService(repo, relationshipRepo);

      await service.review(
        applicationId,
        {
          status: 'APPROVED',
        },
        partnerId,
      );

      expect(relationshipRepo.create).not.toHaveBeenCalled();

      expect(relationshipRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('reactivates an inactive relationship when the application is approved', async () => {
      const repo = repository();

      const relationshipRepo = partnerDriverRepository();

      const inactiveRelationship = partnerDriver({
        status: 'INACTIVE',
      });

      const approvedApplication = application({
        status: 'APPROVED',
        reviewedBy: partnerId,
        approvedBy: partnerId,
        reviewedAt: new Date('2026-01-02'),
        approvedAt: new Date('2026-01-02'),
      });

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          status: 'PENDING',
        }),
      );

      vi.mocked(repo.updateStatus).mockResolvedValue(approvedApplication);

      vi.mocked(relationshipRepo.findByPartnerAndDriver).mockResolvedValue(inactiveRelationship);

      const service = createService(repo, relationshipRepo);

      await service.review(
        applicationId,
        {
          status: 'APPROVED',
        },
        partnerId,
      );

      expect(relationshipRepo.create).not.toHaveBeenCalled();

      expect(relationshipRepo.updateStatus).toHaveBeenCalledWith(relationshipId, 'ACTIVE');
    });

    it('does not create a relationship when application is rejected', async () => {
      const repo = repository();

      const relationshipRepo = partnerDriverRepository();

      const rejectedApplication = application({
        status: 'REJECTED',
        reviewedBy: partnerId,
        reviewedAt: new Date('2026-01-02'),
        reviewReason: 'Invalid documents',
      });

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          status: 'PENDING',
        }),
      );

      vi.mocked(repo.updateStatus).mockResolvedValue(rejectedApplication);

      const service = createService(repo, relationshipRepo);

      await service.review(
        applicationId,
        {
          status: 'REJECTED',
          reviewReason: 'Invalid documents',
        },
        partnerId,
      );

      expect(relationshipRepo.findByPartnerAndDriver).not.toHaveBeenCalled();

      expect(relationshipRepo.create).not.toHaveBeenCalled();
    });

    it('does not create a relationship when changes are requested', async () => {
      const repo = repository();

      const relationshipRepo = partnerDriverRepository();

      const changesRequestedApplication = application({
        status: 'CHANGES_REQUESTED',
        reviewedBy: partnerId,
        reviewedAt: new Date('2026-01-02'),
        reviewReason: 'Additional documents required',
      });

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          status: 'PENDING',
        }),
      );

      vi.mocked(repo.updateStatus).mockResolvedValue(changesRequestedApplication);

      const service = createService(repo, relationshipRepo);

      await service.review(
        applicationId,
        {
          status: 'CHANGES_REQUESTED',
          reviewReason: 'Additional documents required',
        },
        partnerId,
      );

      expect(relationshipRepo.findByPartnerAndDriver).not.toHaveBeenCalled();

      expect(relationshipRepo.create).not.toHaveBeenCalled();
    });

    it('allows rejection only with a reason', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          status: 'PENDING',
        }),
      );

      const service = createService(repo);

      await expect(
        service.review(
          applicationId,
          {
            status: 'REJECTED',
          },
          partnerId,
        ),
      ).rejects.toThrow('Review reason is required for rejection or requested changes.');

      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it('allows requested changes only with a reason', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          status: 'PENDING',
        }),
      );

      const service = createService(repo);

      await expect(
        service.review(
          applicationId,
          {
            status: 'CHANGES_REQUESTED',
          },
          partnerId,
        ),
      ).rejects.toThrow('Review reason is required for rejection or requested changes.');

      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects review of an already approved application', async () => {
      const repo = repository();

      vi.mocked(repo.findById).mockResolvedValue(
        application({
          status: 'APPROVED',
        }),
      );

      const service = createService(repo);

      await expect(
        service.review(
          applicationId,
          {
            status: 'REJECTED',
            reviewReason: 'Invalid documents',
          },
          partnerId,
        ),
      ).rejects.toThrow('Driver application cannot be reviewed from status APPROVED.');

      expect(repo.updateStatus).not.toHaveBeenCalled();
    });
  });
});
