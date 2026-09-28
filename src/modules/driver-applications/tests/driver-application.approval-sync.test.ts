import { describe, expect, it, vi } from 'vitest';

import { DriverApplicationService } from '../driver-application.service.js';
import type { DriverApplicationRepository } from '../driver-application.repository.js';

import type { DriverApplication } from '../driver-application.types.js';

import type { PartnerDriverRepository } from '../../partners/repositories/partner-driver.repository.js';

import type { PartnerRepository } from '../../partners/repositories/partner.repository.js';

import type { DriverRepository } from '../../rides/repositories/driver.repository.js';

const partnerId = '550e8400-e29b-41d4-a716-446655440000';

const driverId = '750e8400-e29b-41d4-a716-446655440000';

const applicationId = '950e8400-e29b-41d4-a716-446655440000';

const reviewerId = 'd50e8400-e29b-41d4-a716-446655440000';

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
    create: vi.fn(),
    findById: vi.fn(),
    findActiveByPartnerAndDriver: vi.fn(),
    findByDriverProfileId: vi.fn(),
    list: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function partnerDriverRepository(): PartnerDriverRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByPartnerAndDriver: vi.fn(),
    listByPartner: vi.fn(),
    listByDriver: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function partnerRepository(): PartnerRepository {
  return {
    findByUserId: vi.fn(),
    findById: vi.fn(),
  } as unknown as PartnerRepository;
}

function driverRepository(): DriverRepository {
  return {
    findProfileIdByUserId: vi.fn(),
    findProfileByUserId: vi.fn(),
    findProfileById: vi.fn(),
    upsertProfile: vi.fn(),

    getAvailability: vi.fn(),
    updateAvailability: vi.fn(),

    setBusy: vi.fn(),
    releaseBusy: vi.fn(),

    updateLocation: vi.fn(),
    markStale: vi.fn(),

    findActiveVehicleByUserId: vi.fn(),
    findNearbyEligible: vi.fn(),

    verifyAssignmentCode: vi.fn(),
    claimAssignmentCode: vi.fn(),

    setActiveVehicle: vi.fn(),
    getAssignedVehicle: vi.fn(),

    updateVerificationStatus: vi.fn().mockResolvedValue(true),
  } as unknown as DriverRepository;
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

describe('DriverApplicationService - approval sync', () => {
  it('syncs driver verification when an application is approved', async () => {
    const repo = repository();
    const relationshipRepo = partnerDriverRepository();
    const driverRepo = driverRepository();

    const pendingApplication = application({
      status: 'PENDING',
    });

    const approvedApplication = application({
      status: 'APPROVED',
      reviewedBy: reviewerId,
      approvedBy: reviewerId,
      reviewedAt: new Date('2026-01-02'),
      approvedAt: new Date('2026-01-02'),
    });

    vi.mocked(repo.findById).mockResolvedValue(pendingApplication);

    vi.mocked(repo.updateStatus).mockResolvedValue(approvedApplication);

    vi.mocked(relationshipRepo.findByPartnerAndDriver).mockResolvedValue(null);

    vi.mocked(relationshipRepo.create).mockResolvedValue({
      id: 'a50e8400-e29b-41d4-a716-446655440000',
      partnerId,
      driverProfileId: driverId,
      status: 'ACTIVE',
      createdAt: new Date('2026-01-02'),
      updatedAt: new Date('2026-01-02'),
    });

    const service = createService(repo, relationshipRepo, undefined, driverRepo);

    await service.review(
      applicationId,
      {
        status: 'APPROVED',
      },
      reviewerId,
    );

    expect(driverRepo.updateVerificationStatus).toHaveBeenCalledWith(
      driverId,
      'approved',
      null,
      reviewerId,
    );
  });

  it('syncs driver rejection when an application is rejected', async () => {
    const repo = repository();
    const relationshipRepo = partnerDriverRepository();
    const driverRepo = driverRepository();

    const pendingApplication = application({
      status: 'PENDING',
    });

    const rejectedApplication = application({
      status: 'REJECTED',
      reviewedBy: reviewerId,
      reviewedAt: new Date('2026-01-02'),
      reviewReason: 'Invalid documents',
    });

    vi.mocked(repo.findById).mockResolvedValue(pendingApplication);

    vi.mocked(repo.updateStatus).mockResolvedValue(rejectedApplication);

    const service = createService(repo, relationshipRepo, undefined, driverRepo);

    await service.review(
      applicationId,
      {
        status: 'REJECTED',
        reviewReason: 'Invalid documents',
      },
      reviewerId,
    );

    expect(driverRepo.updateVerificationStatus).toHaveBeenCalledWith(
      driverId,
      'rejected',
      'Invalid documents',
      reviewerId,
    );

    expect(relationshipRepo.findByPartnerAndDriver).not.toHaveBeenCalled();
  });

  it('does not change driver verification when changes are requested', async () => {
    const repo = repository();
    const relationshipRepo = partnerDriverRepository();
    const driverRepo = driverRepository();

    const pendingApplication = application({
      status: 'PENDING',
    });

    const changesRequestedApplication = application({
      status: 'CHANGES_REQUESTED',
      reviewedBy: reviewerId,
      reviewedAt: new Date('2026-01-02'),
      reviewReason: 'Additional documents required',
    });

    vi.mocked(repo.findById).mockResolvedValue(pendingApplication);

    vi.mocked(repo.updateStatus).mockResolvedValue(changesRequestedApplication);

    const service = createService(repo, relationshipRepo, undefined, driverRepo);

    await service.review(
      applicationId,
      {
        status: 'CHANGES_REQUESTED',
        reviewReason: 'Additional documents required',
      },
      reviewerId,
    );

    expect(driverRepo.updateVerificationStatus).not.toHaveBeenCalled();

    expect(relationshipRepo.findByPartnerAndDriver).not.toHaveBeenCalled();
  });
});
