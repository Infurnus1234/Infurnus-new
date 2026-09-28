import type { AuthenticatedUser } from '../auth/types/auth.js';

import type {
  CreateDriverApplicationInput,
  DriverApplication,
  DriverApplicationFilters,
  ReviewDriverApplicationInput,
} from './driver-application.types.js';

import type { DriverApplicationRepository } from './driver-application.repository.js';

import type { PartnerDriverRepository } from '../partners/repositories/partner-driver.repository.js';

import type { PartnerRepository } from '../partners/repositories/partner.repository.js';

import type { DriverRepository } from '../rides/repositories/driver.repository.js';

export class DriverApplicationService {
  constructor(
    private readonly repository: DriverApplicationRepository,
    private readonly partnerDriverRepository: PartnerDriverRepository,
    private readonly partnerRepository: PartnerRepository,
    private readonly driverRepository: DriverRepository,
  ) {}

  private isAdmin(actor: AuthenticatedUser): boolean {
    return actor.role === 'admin' || actor.role === 'super_admin';
  }

  private async getOwnedPartnerId(actor: AuthenticatedUser): Promise<string | null> {
    const partner = await this.partnerRepository.findByUserId(actor.userId);

    return partner?.id ?? null;
  }

  private async getOwnedDriverProfileId(actor: AuthenticatedUser): Promise<string | null> {
    return this.driverRepository.findProfileIdByUserId(actor.userId);
  }

  private async assertApplicationAccess(
    actor: AuthenticatedUser,
    application: DriverApplication,
  ): Promise<void> {
    if (this.isAdmin(actor)) {
      return;
    }

    const partnerId = await this.getOwnedPartnerId(actor);

    if (partnerId === application.partnerId) {
      return;
    }

    const driverProfileId = await this.getOwnedDriverProfileId(actor);

    if (driverProfileId === application.driverProfileId) {
      return;
    }

    throw new Error('You do not have access to this driver application.');
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateDriverApplicationInput,
  ): Promise<DriverApplication> {
    /*
     * Admin/Super Admin are reviewers, not application creators.
     *
     * Driver applications can only be initiated by:
     * - The Partner who owns the partner profile
     * - The Driver who owns the driver profile
     */
    if (this.isAdmin(actor)) {
      throw new Error('Admin and Super Admin cannot create driver applications.');
    }

    const partner = await this.partnerRepository.findById(input.partnerId);

    if (!partner) {
      throw new Error('Partner not found.');
    }

    /*
     * A Partner must be approved before it can
     * onboard/associate a Driver.
     */
    if (partner.approvalStatus !== 'approved') {
      throw new Error('Partner must be approved before creating a driver application.');
    }

    /*
     * Verify that the Driver Profile exists.
     *
     * Driver verification/approval is intentionally
     * NOT required here because the Driver Application
     * itself is part of the onboarding/review flow.
     */
    const driverProfile = await this.driverRepository.findProfileById(input.driverProfileId);

    if (!driverProfile) {
      throw new Error('Driver profile not found.');
    }

    /*
     * Authorization:
     *
     * Partner can create an application only for
     * its own partner profile.
     *
     * Driver can create an application only for
     * their own driver profile.
     */
    const ownedPartnerId = await this.getOwnedPartnerId(actor);

    const ownedDriverProfileId = await this.getOwnedDriverProfileId(actor);

    const isPartnerOwner = ownedPartnerId === input.partnerId;

    const isDriverOwner = ownedDriverProfileId === input.driverProfileId;

    if (!isPartnerOwner && !isDriverOwner) {
      throw new Error('You do not have permission to create this driver application.');
    }

    /*
     * Prevent duplicate active application for
     * the same Partner + Driver combination.
     */
    const existingApplication = await this.repository.findActiveByPartnerAndDriver(
      input.partnerId,
      input.driverProfileId,
    );

    if (existingApplication) {
      throw new Error('An active driver application already exists for this partner and driver.');
    }

    /*
     * A Driver should not have multiple active
     * onboarding applications at the same time.
     */
    const existingDriverApplication = await this.repository.findByDriverProfileId(
      input.driverProfileId,
    );

    if (
      existingDriverApplication &&
      ['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(existingDriverApplication.status)
    ) {
      throw new Error('An active driver application already exists for this driver.');
    }

    return this.repository.create(input);
  }

  async getById(actor: AuthenticatedUser, id: string): Promise<DriverApplication> {
    const application = await this.repository.findById(id);

    if (!application) {
      throw new Error('Driver application not found.');
    }

    await this.assertApplicationAccess(actor, application);

    return application;
  }

  async getByDriverProfileId(
    actor: AuthenticatedUser,
    driverProfileId: string,
  ): Promise<DriverApplication> {
    const application = await this.repository.findByDriverProfileId(driverProfileId);

    if (!application) {
      throw new Error('Driver application not found.');
    }

    await this.assertApplicationAccess(actor, application);

    return application;
  }

  async list(
    actor: AuthenticatedUser,
    filters: DriverApplicationFilters,
  ): Promise<{
    items: DriverApplication[];
    total: number;
  }> {
    if (this.isAdmin(actor)) {
      return this.repository.list(filters);
    }

    const partnerId = await this.getOwnedPartnerId(actor);

    /*
     * Fleet Owner and Driver + Fleet Owner
     * are scoped by their Partner.
     *
     * A driver_fleet_owner can own both:
     * - a Partner profile
     * - a Driver profile
     *
     * Partner scope takes priority so that
     * the user can view applications belonging
     * to the complete fleet, not only their own
     * driver profile.
     */
    if (partnerId) {
      const { driverProfileId: _driverProfileId, ...partnerScopedFilters } = filters;

      return this.repository.list({
        ...partnerScopedFilters,
        partnerId,
      });
    }

    /*
     * A normal Driver without a Partner profile
     * can only view applications belonging to
     * their own Driver Profile.
     */
    const driverProfileId = await this.getOwnedDriverProfileId(actor);

    if (driverProfileId) {
      const { partnerId: _partnerId, ...driverScopedFilters } = filters;

      return this.repository.list({
        ...driverScopedFilters,
        driverProfileId,
      });
    }

    throw new Error('You do not have permission to view driver applications.');
  }

  async review(
    id: string,
    review: ReviewDriverApplicationInput,
    reviewerId: string,
  ): Promise<DriverApplication> {
    const application = await this.repository.findById(id);

    if (!application) {
      throw new Error('Driver application not found.');
    }

    if (['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(application.status) === false) {
      throw new Error(`Driver application cannot be reviewed from status ${application.status}.`);
    }

    if (
      (review.status === 'REJECTED' || review.status === 'CHANGES_REQUESTED') &&
      !review.reviewReason?.trim()
    ) {
      throw new Error('Review reason is required for rejection or requested changes.');
    }

    const updatedApplication = await this.repository.updateStatus(id, review, reviewerId);

    if (!updatedApplication) {
      throw new Error('Failed to update driver application.');
    }

    /*
     * Driver verification synchronization:
     *
     * Application APPROVED
     *        ↓
     * Driver Profile → APPROVED
     *
     * Application REJECTED
     *        ↓
     * Driver Profile → REJECTED
     *
     * CHANGES_REQUESTED does not change the
     * driver verification status because the
     * driver verification enum has no equivalent
     * "changes requested" state.
     */
    if (updatedApplication.status === 'APPROVED') {
      const verificationUpdated = await this.driverRepository.updateVerificationStatus(
        updatedApplication.driverProfileId,
        'approved',
        null,
        reviewerId,
      );

      if (!verificationUpdated) {
        throw new Error('Failed to update driver verification status.');
      }
    }

    if (updatedApplication.status === 'REJECTED') {
      const verificationUpdated = await this.driverRepository.updateVerificationStatus(
        updatedApplication.driverProfileId,
        'rejected',
        review.reviewReason ?? null,
        reviewerId,
      );

      if (!verificationUpdated) {
        throw new Error('Failed to update driver verification status.');
      }
    }

    /*
     * Governance rule:
     *
     * Application APPROVED
     *        ↓
     * Partner ↔ Driver relationship
     *        ↓
     * ACTIVE
     *
     * Partner/Driver themselves never create
     * an ACTIVE relationship directly.
     */
    if (updatedApplication.status === 'APPROVED') {
      const existingRelationship = await this.partnerDriverRepository.findByPartnerAndDriver(
        updatedApplication.partnerId,
        updatedApplication.driverProfileId,
      );

      if (!existingRelationship) {
        await this.partnerDriverRepository.create({
          partnerId: updatedApplication.partnerId,
          driverProfileId: updatedApplication.driverProfileId,
        });
      } else if (existingRelationship.status === 'INACTIVE') {
        await this.partnerDriverRepository.updateStatus(existingRelationship.id, 'ACTIVE');
      }
    }

    return updatedApplication;
  }
}
