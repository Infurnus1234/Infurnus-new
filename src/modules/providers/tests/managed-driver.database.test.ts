import { FleetInvitationRepository } from '../repositories/fleet-invitation.repository.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { actor, fixture } from './fleet-workflow-fixture.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { ManagedDriverRepository } from '../repositories/managed-driver.repository.js';
import { RoleEnrolmentRepository } from '../repositories/role-enrolment.repository.js';
import { PostgresDriverDocumentRepository } from '../../rides/repositories/driver-document.repository.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { onboardingItems } from '../repositories/driver-onboarding-review.js';
const managed = new ManagedDriverRepository(pool),
  enrolment = new RoleEnrolmentRepository(pool),
  documents = new PostgresDriverDocumentRepository(pool);
const profileInput = () => ({
  firstName: 'TEST_SAMPLE',
  lastName: 'Managed',
  email: randomUUID() + '@example.invalid',
  licenseNumber: 'TEST-' + randomUUID(),
  licenseExpiry: '2090-01-01',
});
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Fleet-managed Driver authority and saved onboarding',
  () => {
    beforeAll(() => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Owned disposable database required');
    });
    it('rejects repeat association review for an approved active Fleet member', async () => {
      const f = await fixture();
      await pool.query(
        'INSERT INTO fleet_managed_driver_accounts(driver_user_id,partner_id,created_by) VALUES($1,$2,$3)',
        [f.driver, f.partner, f.owner],
      );
      await expect(managed.submit(f.owner, 'fleet_owner', f.driver)).rejects.toMatchObject({
        code: 'DRIVER_ALREADY_ASSOCIATED',
        statusCode: 409,
      });
      expect(
        (
          await pool.query(
            "SELECT id FROM provider_approval_requests WHERE target_id=$1 AND request_type='driver_association' AND status='PENDING'",
            [f.profile],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT id FROM partner_drivers WHERE partner_id=$1 AND driver_profile_id=$2 AND status='ACTIVE'",
            [f.partner, f.profile],
          )
        ).rowCount,
      ).toBe(1);
    });
    it('creates an OTP-only Driver profile without password, approval or assignment and is idempotent', async () => {
      const f = await fixture(),
        input = profileInput();
      const created = await managed.create(f.owner, 'fleet_owner', input);
      expect(created.verificationStatus).toBe('pending');
      expect((await managed.create(f.owner, 'fleet_owner', input)).userId).toBe(created.userId);
      expect(
        (await pool.query('SELECT id FROM user_credentials WHERE user_id=$1', [created.userId]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query('SELECT driver_profile_id FROM vehicles WHERE driver_profile_id=$1', [
            created.profileId,
          ])
        ).rowCount,
      ).toBe(0);
      const state = await enrolment.state(created.userId, 'driver');
      expect(state.dashboardAccessible).toBe(true);
      expect(state.assignmentStatus).toBe('unassigned');
    });
    it('preserves the existing Customer account when creating a Driver with its email', async () => {
      const f = await fixture(),
        input = profileInput(),
        customer = await actor('customer');
      await pool.query('UPDATE users SET email=$2 WHERE id=$1', [customer, input.email]);
      const created = await managed.create(f.owner, 'fleet_owner', input);
      expect(created.userId).not.toBe(customer);
      expect(
        (await pool.query('SELECT role FROM users WHERE id=$1', [customer])).rows[0].role,
      ).toBe('customer');
    });
    it('cannot take over an existing unrelated Driver or manage another Fleet profile', async () => {
      const a = await fixture(),
        b = await fixture();
      const existing = (await pool.query('SELECT email FROM users WHERE id=$1', [b.driver]))
        .rows[0];
      await expect(
        managed.create(a.owner, 'fleet_owner', { ...profileInput(), email: existing.email }),
      ).rejects.toMatchObject({ statusCode: 409 });
      const created = await managed.create(b.owner, 'fleet_owner', profileInput());
      await expect(managed.detail(a.owner, 'fleet_owner', created.userId)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(managed.create(a.driver, 'driver', profileInput())).rejects.toMatchObject({
        statusCode: 403,
      });
    });
    it('owner uploads remain pending, are audited as the owner, and saved photo is not repeated', async () => {
      const f = await fixture(),
        created = await managed.create(f.owner, 'fleet_owner', profileInput());
      const input = {
        driverProfileId: created.profileId,
        documentType: 'profile_photo' as const,
        storageProvider: 'cloudinary' as const,
        storageKey: 'TEST_SAMPLE/local/photo.png',
        resourceType: 'image' as const,
        accessMode: 'authenticated' as const,
        mimeType: 'image/png',
        fileSize: 100,
        uploadedBy: f.owner,
      };
      const saved = await documents.saveBundle(input, []);
      expect(saved.document.verificationStatus).toBe('pending');
      expect(saved.document.uploadedBy).toBe(f.owner);
      expect((await enrolment.state(created.userId, 'driver')).progress.profile_photo).toBe(
        'completed',
      );
      expect((await enrolment.photo(created.userId, 'driver')).storageKey).toBe(input.storageKey);
      const other = await fixture();
      await expect(documents.saveBundle({ ...input, uploadedBy: other.owner }, [])).rejects.toThrow(
        'not authorized',
      );
    });
    it('required licence and independent Admin review remain enforced before association', async () => {
      const f = await fixture(),
        created = await managed.create(f.owner, 'fleet_owner', profileInput());
      await expect(managed.submit(f.owner, 'fleet_owner', created.userId)).rejects.toMatchObject({
        statusCode: 409,
      });
      await documents.saveBundle(
        {
          driverProfileId: created.profileId,
          documentType: 'driver_license',
          storageProvider: 'cloudinary',
          storageKey: 'TEST_SAMPLE/local/licence.png',
          resourceType: 'image',
          accessMode: 'authenticated',
          mimeType: 'image/png',
          fileSize: 100,
          uploadedBy: f.owner,
          documentMetadata: { expiresAt: '2090-01-01' },
        },
        [],
      );
      const pending = await managed.submit(f.owner, 'fleet_owner', created.userId);
      expect(
        (await managed.detail(f.owner, 'fleet_owner', created.userId)).profile.verificationStatus,
      ).toBe('pending');
      const c = await pool.connect();
      let items;
      try {
        items = await onboardingItems(c, created.profileId);
      } finally {
        c.release();
      }
      const profile = (
        await pool.query('SELECT updated_at::text AS ts FROM driver_profiles WHERE id=$1', [
          created.profileId,
        ])
      ).rows[0];
      const ops = new PostgresProviderOperationsRepository(pool);
      await ops.reviewOnboarding(f.admin, pending.id, {
        status: 'APPROVED',
        expectedUpdatedAt: profile.ts,
        items: items
          .filter((x) => x.status === 'PENDING')
          .map((x) => ({ id: x.id, expectedUpdatedAt: x.expected_updated_at })),
      });
      expect(
        (await managed.detail(f.owner, 'fleet_owner', created.userId)).profile.verificationStatus,
      ).toBe('approved');
      expect(
        (
          await pool.query('SELECT id FROM partner_drivers WHERE driver_profile_id=$1', [
            created.profileId,
          ])
        ).rowCount,
      ).toBe(0);
      const association = await managed.submit(f.owner, 'fleet_owner', created.userId);
      const current = (
        await pool.query('SELECT updated_at::text AS ts FROM driver_profiles WHERE id=$1', [
          created.profileId,
        ])
      ).rows[0];
      await ops.reviewApproval(f.admin, association.id, {
        status: 'APPROVED',
        expectedUpdatedAt: current.ts,
      });
      await expect(
        managed.assign(f.owner, 'fleet_owner', created.userId, 'invalid'),
      ).rejects.toMatchObject({ statusCode: 409 });
      const driverRepo = new (
        await import('../../rides/repositories/driver.repository.js')
      ).PostgresDriverRepository(pool);
      expect((await managed.assign(f.owner, 'fleet_owner', created.userId, f.code)).vehicleId).toBe(
        f.vehicle.id,
      );
      expect((await driverRepo.getAssignedVehicle(created.profileId))?.id).toBe(f.vehicle.id);
    });
    it('accepts an authenticated account-bound invitation without assigning a vehicle or creating Fleet membership', async () => {
      const f = await fixture(),
        existing = await actor('driver'),
        api = new FleetInvitationRepository(pool);
      const email = (await pool.query('SELECT email FROM users WHERE id=$1', [existing])).rows[0]
        .email;
      const invitation = await enrolment.addDriver(f.owner, 'fleet_owner', email);
      expect((await api.list(existing, 'driver')).map((x) => x.id)).toContain(invitation.id);
      await expect(api.accept(f.driver, 'driver', invitation.id)).rejects.toMatchObject({
        statusCode: 409,
      });
      await api.accept(existing, 'driver', invitation.id);
      await api.accept(existing, 'driver', invitation.id);
      const created = await managed.create(f.owner, 'fleet_owner', { ...profileInput(), email });
      expect(created.userId).toBe(existing);
      expect(
        (
          await pool.query('SELECT id FROM partner_drivers WHERE driver_profile_id=$1', [
            created.profileId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query('SELECT active_vehicle_id FROM driver_profiles WHERE id=$1', [
            created.profileId,
          ])
        ).rows[0].active_vehicle_id,
      ).toBeNull();
    });
  },
);
