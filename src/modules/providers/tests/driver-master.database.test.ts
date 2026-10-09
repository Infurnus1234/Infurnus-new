import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';

describe.runIf(process.env.DRIVER_IMPLEMENTATION_DB_TESTS === 'true')(
  'Driver audit real PostgreSQL regressions',
  () => {
    const drivers = new PostgresDriverRepository(pool);
    const rides = new PostgresRideRepository(pool);
    const adminRepo = new PostgresAdminRepository(pool);
    let driver: string,
      owner: string,
      admin: string,
      customer: string,
      profile: string,
      fleet: string,
      vehicle: string,
      ride: string;
    let users: string[] = [];
    beforeEach(async () => {
      if (new URL(process.env.DATABASE_URL!).port !== '5434')
        throw new Error('These regressions require the isolated audit database on port 5434');
      users = [];
      for (const role of ['driver_fleet_owner', 'fleet_owner', 'admin', 'customer']) {
        const id = (
          await pool.query(
            "INSERT INTO users(first_name,last_name,email,role,status) VALUES('Audit','Fixture',$1,$2,'active') RETURNING id",
            [`audit-${randomUUID()}@example.invalid`, role],
          )
        ).rows[0].id;
        users.push(id);
      }
      driver = users[0]!;
      owner = users[1]!;
      admin = users[2]!;
      customer = users[3]!;
      fleet = (
        await pool.query(
          "INSERT INTO partners(user_id,business_name) VALUES($1,'Audit Fleet') RETURNING id",
          [owner],
        )
      ).rows[0].id;
      await pool.query(
        "UPDATE partners SET approval_status='under_review',reviewed_by=$2,reviewed_at=NOW() WHERE id=$1",
        [fleet, admin],
      );
      await pool.query(
        "UPDATE partners SET approval_status='approved',approved_by=$2,approved_at=NOW() WHERE id=$1",
        [fleet, admin],
      );
      profile = (
        await pool.query(
          "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status) VALUES($1,$2,CURRENT_DATE+365,'approved') RETURNING id",
          [driver, randomUUID()],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO partner_drivers(partner_id,driver_profile_id,status) VALUES($1,$2,'ACTIVE')",
        [fleet, profile],
      );
      vehicle = (
        await pool.query(
          "INSERT INTO vehicles(owner_id,driver_profile_id,make,model,plate_number,verification_status,is_active,registration_expiry) VALUES($1,$2,'Audit','Fixture',$3,'approved',TRUE,CURRENT_DATE+365) RETURNING id",
          [owner, profile, randomUUID().slice(0, 18)],
        )
      ).rows[0].id;
      await pool.query(
        "UPDATE driver_profiles SET active_vehicle_id=$2,availability_status='available',last_location=ST_SetSRID(ST_MakePoint(77.5946,12.9716),4326)::geography,last_location_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [profile, vehicle],
      );
      ride = '';
    });
    afterEach(async () => {
      await pool.query(
        'DELETE FROM provider_document_requirements WHERE updated_by=ANY($1::uuid[])',
        [users],
      );
      await pool.query('DELETE FROM ride_dispatch_attempts WHERE driver_profile_id=$1', [profile]);
      await pool.query('DELETE FROM rides WHERE customer_id=$1', [customer]);
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[]) OR reviewer_id=ANY($1::uuid[])',
        [users],
      );
      await pool.query(
        'DELETE FROM partner_documents WHERE partner_id IN(SELECT id FROM partners WHERE user_id=ANY($1::uuid[]))',
        [users],
      );
      await pool.query(
        'UPDATE driver_profiles SET active_vehicle_id=NULL WHERE user_id=ANY($1::uuid[])',
        [users],
      );
      await pool.query('DELETE FROM vehicles WHERE owner_id=ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM partner_drivers WHERE driver_profile_id=$1', [profile]);
      await pool.query('DELETE FROM driver_documents WHERE driver_profile_id=$1', [profile]);
      await pool.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM partners WHERE user_id=ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
    });
    const eligible = () =>
      drivers.findNearbyEligible(12.9716, 77.5946, 1000, 10, new Date(Date.now() - 30000));
    it('finds a correctly approved combined Driver with current fleet membership', async () => {
      expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(true);
    });
    it.each(['suspended', 'banned'])(
      'excludes a cached available Driver whose account is %s',
      async (status) => {
        await pool.query('UPDATE users SET status=$2 WHERE id=$1', [driver, status]);
        expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(false);
      },
    );
    it('excludes a deleted account and a stale role', async () => {
      await pool.query('UPDATE users SET deleted_at=NOW() WHERE id=$1', [driver]);
      expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(false);
      await pool.query("UPDATE users SET deleted_at=NULL,role='customer' WHERE id=$1", [driver]);
      expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(false);
    });
    it('rejects licence/registration expiry and missing active vehicle even when legacy approval remains', async () => {
      await pool.query('UPDATE driver_profiles SET license_expiry=CURRENT_DATE-1 WHERE id=$1', [
        profile,
      ]);
      await pool.query(
        "UPDATE driver_profiles SET verification_status='approved',availability_status='available' WHERE id=$1",
        [profile],
      );
      expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(false);
      await pool.query('UPDATE driver_profiles SET license_expiry=CURRENT_DATE+365 WHERE id=$1', [
        profile,
      ]);
      await pool.query(
        "UPDATE driver_profiles SET verification_status='approved',availability_status='available' WHERE id=$1",
        [profile],
      );
      await pool.query('UPDATE vehicles SET registration_expiry=CURRENT_DATE-1 WHERE id=$1', [
        vehicle,
      ]);
      expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(false);
      await pool.query('UPDATE vehicles SET registration_expiry=CURRENT_DATE+365 WHERE id=$1', [
        vehicle,
      ]);
      await pool.query('UPDATE driver_profiles SET active_vehicle_id=NULL WHERE id=$1', [profile]);
      expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(false);
    });
    it('revoked membership cannot dispatch or revive availability through GPS', async () => {
      await pool.query(
        "UPDATE partner_drivers SET status='INACTIVE' WHERE partner_id=$1 AND driver_profile_id=$2",
        [fleet, profile],
      );
      expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(false);
      await pool.query("UPDATE driver_profiles SET availability_status='stale' WHERE id=$1", [
        profile,
      ]);
      await drivers.updateLocation(profile, {
        latitude: 12.9716,
        longitude: 77.5946,
        recordedAt: new Date(),
        speed: 0,
        heading: 0,
        accuracy: 5,
      });
      expect(await drivers.getAvailability(profile)).not.toBe('available');
    });
    it('configured missing documents exclude cached approval from matching', async () => {
      await pool.query(
        "INSERT INTO provider_document_requirements(provider_role,document_code,required,updated_by) VALUES('driver_fleet_owner',$1,TRUE,$2)",
        ['audit_' + randomUUID().replaceAll('-', ''), admin],
      );
      expect((await eligible()).some((d) => d.driverProfileId === profile)).toBe(false);
    });
    it('busy release cannot make a suspended account available', async () => {
      await pool.query("UPDATE driver_profiles SET availability_status='busy' WHERE id=$1", [
        profile,
      ]);
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [driver]);
      await drivers.releaseBusy(profile);
      expect(await drivers.getAvailability(profile)).toBe('unavailable');
    });
    it('legacy document approval/rejection uses existing metadata, current reviewer and modern expiry checks', async () => {
      const document = (
        await pool.query(
          "INSERT INTO partner_documents(partner_id,document_type,status) VALUES($1,'PAN','PENDING') RETURNING id",
          [fleet],
        )
      ).rows[0].id;
      expect(await adminRepo.verifyDocument(document, 'REJECTED', 'Unreadable', admin)).toBe(true);
      let row = (await pool.query('SELECT * FROM partner_documents WHERE id=$1', [document]))
        .rows[0];
      expect(row.status).toBe('REJECTED');
      expect(row.metadata.rejectionReason).toBe('Unreadable');
      expect(row.reviewed_by).toBe(admin);
      await pool.query(
        "UPDATE partner_documents SET status='SUBMITTED',expires_at=CURRENT_DATE-1 WHERE id=$1",
        [document],
      );
      await expect(
        adminRepo.verifyDocument(document, 'VERIFIED', undefined, admin),
      ).rejects.toMatchObject({ code: 'DOCUMENT_EXPIRED' });
      await pool.query('UPDATE partner_documents SET expires_at=CURRENT_DATE+365 WHERE id=$1', [
        document,
      ]);
      expect(await adminRepo.verifyDocument(document, 'VERIFIED', undefined, admin)).toBe(true);
      row = (await pool.query('SELECT * FROM partner_documents WHERE id=$1', [document])).rows[0];
      expect(row.status).toBe('VERIFIED');
      expect(row.reviewed_at).toBeInstanceOf(Date);
      expect(row.metadata.rejectionReason).toBeNull();
    });
    it('legacy mutations reject a suspended or demoted administrator and missing actor', async () => {
      await expect(adminRepo.verifyDriver(profile, 'approved')).rejects.toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
      });
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [admin]);
      await expect(
        adminRepo.verifyDriver(profile, 'approved', undefined, admin),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await pool.query("UPDATE users SET status='active',role='customer' WHERE id=$1", [admin]);
      await expect(
        adminRepo.verifyVehicle(vehicle, 'APPROVED', undefined, admin),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
    it('legacy Driver approval records reviewer and rejects an expired licence', async () => {
      await pool.query("UPDATE driver_profiles SET verification_status='pending' WHERE id=$1", [
        profile,
      ]);
      expect(await adminRepo.verifyDriver(profile, 'approved', undefined, admin)).toBe(true);
      expect(
        (await pool.query('SELECT verified_by FROM driver_profiles WHERE id=$1', [profile])).rows[0]
          .verified_by,
      ).toBe(admin);
      await pool.query('UPDATE driver_profiles SET license_expiry=CURRENT_DATE-1 WHERE id=$1', [
        profile,
      ]);
      await expect(
        adminRepo.verifyDriver(profile, 'approved', undefined, admin),
      ).rejects.toMatchObject({ code: 'DOCUMENT_EXPIRED' });
    });
    it('modern and legacy document review enforce configured page/expiry policy', async () => {
      const code = 'audit_' + randomUUID().replaceAll('-', '');
      const document = (
        await pool.query(
          "INSERT INTO partner_documents(partner_id,document_type,status,metadata) VALUES($1,'OTHER','PENDING',jsonb_build_object('documentCode',$2::text)) RETURNING id",
          [fleet, code],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO provider_document_requirements(provider_role,document_code,requires_expiry,minimum_pages,updated_by) VALUES('fleet_owner',$1,TRUE,2,$2)",
        [code, admin],
      );
      await expect(
        adminRepo.verifyDocument(document, 'VERIFIED', undefined, admin),
      ).rejects.toMatchObject({ code: 'DOCUMENT_REQUIREMENTS_NOT_MET' });
    });
    it('owned selection cannot steal another owner vehicle and atomically selects an eligible own vehicle', async () => {
      await pool.query('UPDATE vehicles SET driver_profile_id=NULL WHERE id=$1', [vehicle]);
      await pool.query('UPDATE driver_profiles SET active_vehicle_id=NULL WHERE id=$1', [profile]);
      expect(await drivers.setActiveVehicle(profile, vehicle)).toBe(false);
      await pool.query('UPDATE vehicles SET owner_id=$2 WHERE id=$1', [vehicle, driver]);
      expect(await drivers.setActiveVehicle(profile, vehicle)).toBe(true);
      expect((await drivers.getAssignedVehicle(profile))?.id).toBe(vehicle);
      expect(await drivers.getAvailability(profile)).toBe('unavailable');
    });
    it('concurrent failed PINs persist and lock across repository instances; unrelated/terminal rides cannot verify', async () => {
      ride = (
        await pool.query(
          "INSERT INTO rides(customer_id,assigned_driver_id,assigned_vehicle_id,status,pin,pickup_location,destination_location) VALUES($1,$2,$3,'driver_arrived','7391',ST_SetSRID(ST_MakePoint(77.5946,12.9716),4326)::geography,ST_SetSRID(ST_MakePoint(77.6,12.98),4326)::geography) RETURNING id",
          [customer, profile, vehicle],
        )
      ).rows[0].id;
      expect(await rides.verifyPinAttempt(ride, randomUUID(), '7391')).toBe('forbidden');
      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          new PostgresRideRepository(pool).verifyPinAttempt(ride, profile, '0000'),
        ),
      );
      expect(attempts.filter((v) => v === 'locked')).toHaveLength(1);
      expect(await rides.verifyPinAttempt(ride, profile, '7391')).toBe('locked');
      await pool.query(
        "UPDATE rides SET route_metadata=route_metadata||jsonb_build_object('pinLockedUntil',0,'pinFailedAttempts',0) WHERE id=$1",
        [ride],
      );
      expect(await rides.verifyPinAttempt(ride, profile, '7391')).toBe('verified');
      expect(await rides.isPinVerified(ride)).toBe(true);
      await pool.query(
        "UPDATE rides SET status='cancelled',cancelled_at=NOW(),cancellation_reason='Audit fixture' WHERE id=$1",
        [ride],
      );
      expect(await rides.verifyPinAttempt(ride, profile, '7391')).toBe('invalid_state');
    });
  },
);
