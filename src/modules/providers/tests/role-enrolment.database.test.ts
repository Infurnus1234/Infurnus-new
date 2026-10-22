import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { RoleEnrolmentRepository } from '../repositories/role-enrolment.repository.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { requireDriverEnrolment } from '../services/driver-enrolment-gate.js';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Role onboarding, invitation binding and six-digit vehicle codes',
  () => {
    const repo = new RoleEnrolmentRepository(pool),
      fleet = new PostgresFleetRepository(pool),
      drivers = new PostgresDriverRepository(pool);
    const ids = Array.from({ length: 8 }, () => randomUUID());
    let partner: string, vehicle: string, profile: string, otherProfile: string;
    beforeAll(async () => {
      const db = new URL(process.env.DATABASE_URL!);
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(db.pathname))
        throw Error('Owned disposable database required');
      for (const [i, role] of [
        'admin',
        'fleet_owner',
        'driver',
        'driver',
        'driver_fleet_owner',
        'fleet_owner',
      ].entries())
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Role',$2,$3)",
          [ids[i], ids[i] + '@example.invalid', role],
        );
      await pool.query(
        "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Provisional',$2,'driver') ON CONFLICT DO NOTHING",
        [ids[6], ids[6] + '@example.invalid'],
      );
      await pool.query(
        "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Customer',$2,'customer')",
        [ids[7], ids[7] + '@example.invalid'],
      );
      partner = (
        await pool.query(
          "INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_SAMPLE Role Fleet') RETURNING id",
          [ids[1]],
        )
      ).rows[0].id;
      await pool.query(
        "UPDATE partners SET approval_status='under_review',reviewed_by=$2,reviewed_at=NOW() WHERE id=$1",
        [partner, ids[0]],
      );
      await pool.query(
        "UPDATE partners SET approval_status='approved',approved_by=$2,approved_at=NOW() WHERE id=$1",
        [partner, ids[0]],
      );
    });
    afterAll(async () => {
      await pool.query('DELETE FROM rides WHERE customer_id=$1', [ids[7]]);
      await pool.query('DELETE FROM driver_assignment_codes WHERE fleet_owner_id=ANY($1::uuid[])', [
        ids,
      ]);
      await pool.query(
        'DELETE FROM driver_onboarding_invitations WHERE driver_user_id=ANY($1::uuid[])',
        [ids],
      );
      await pool.query('DELETE FROM provider_onboarding WHERE user_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM partner_drivers WHERE partner_id=$1', [partner]);
      await pool.query('DELETE FROM vehicles WHERE owner_id=ANY($1::uuid[])', [ids]);
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [ids],
      );
      await pool.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM partners WHERE user_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM user_history WHERE user_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    });
    it('preserves account-bound invitation security while vehicle assignment is optional for dashboard access', async () => {
      const s = await repo.state(ids[2]!, 'driver');
      expect(s.steps).toEqual(['vehicle_assignment', 'profile_photo']);
      expect(s.dashboardAccessible).toBe(false);
      await expect(repo.state(ids[2]!, 'driver', { complete: true })).rejects.toMatchObject({
        statusCode: 403,
      });
      const app = express();
      app.get('/driver-data', requireAuth, requireDriverEnrolment, (_req, res) =>
        res.json({ ok: true }),
      );
      app.use(errorMiddleware);
      const token = await signAccessToken({ sub: ids[2]!, role: 'driver', type: 'access' });
      expect(
        (
          await request(app)
            .get('/driver-data')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(403);
      const invitation = await repo.addDriver(ids[1]!, 'fleet_owner', ids[2] + '@example.invalid');
      expect(invitation.code!).toMatch(/^[A-F0-9]{12}$/);
      await expect(repo.verifyCode(ids[3]!, 'driver', invitation.code!)).rejects.toMatchObject({
        statusCode: 400,
      });
      await repo.verifyCode(ids[2]!, 'driver', invitation.code!);
      await repo.verifyCode(ids[2]!, 'driver', invitation.code!);
      await repo.state(ids[2]!, 'driver', { step: 'vehicle_assignment', skipped: true });
      await repo.state(ids[2]!, 'driver', { step: 'profile_photo', skipped: true });
      expect((await repo.state(ids[2]!, 'driver', { complete: true })).dashboardAccessible).toBe(
        true,
      );
      expect(
        (
          await request(app)
            .get('/driver-data')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(200);
      expect(
        (await pool.query('SELECT id FROM driver_profiles WHERE user_id=$1', [ids[2]])).rowCount,
      ).toBe(0);
      expect(
        (await pool.query('SELECT id FROM partner_drivers WHERE partner_id=$1', [partner]))
          .rowCount,
      ).toBe(0);
      expect((await repo.state(ids[2]!, 'driver')).completed).toBe(true);
    });
    it.each([
      ['driver_fleet_owner', 4, ['licence', 'profile_photo', 'details']],
      ['fleet_owner', 5, ['business', 'driver', 'vehicle']],
    ] as const)('persists optional %s setup without fake entities', async (role, index, steps) => {
      for (const step of steps) await repo.state(ids[index]!, role, { step, skipped: true });
      const s = await repo.state(ids[index]!, role, { complete: true });
      expect(s.dashboardAccessible).toBe(true);
      expect(s.codeVerified).toBe(false);
      expect(
        (await pool.query('SELECT id FROM partners WHERE user_id=$1', [ids[index]])).rowCount,
      ).toBe(0);
      await expect(repo.selectRole(ids[index]!, role, 'driver')).rejects.toMatchObject({
        statusCode: 409,
      });
    });
    it('rejects unauthorized issuance, revoked and expired invitations without resetting saved onboarding', async () => {
      await expect(
        repo.addDriver(ids[3]!, 'driver', ids[2] + '@example.invalid'),
      ).rejects.toMatchObject({ statusCode: 403 });
      const old = await repo.addDriver(ids[1]!, 'fleet_owner', ids[3] + '@example.invalid');
      const next = await repo.addDriver(ids[1]!, 'fleet_owner', ids[3] + '@example.invalid');
      await expect(repo.verifyCode(ids[3]!, 'driver', old.code!)).rejects.toMatchObject({
        statusCode: 400,
      });
      await pool.query(
        "UPDATE driver_onboarding_invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [next.id],
      );
      await expect(repo.verifyCode(ids[3]!, 'driver', next.code!)).rejects.toMatchObject({
        statusCode: 400,
      });
    });
    it('returns owner-scoped empty financial records and rejects Driver financial access', async () => {
      const report = await repo.fleetReport(ids[5]!, 'fleet_owner', '2026-10');
      expect(report.final_fare_revenue).toBe('0');
      expect(report.paymentHistory).toEqual([]);
      expect(report.pending_payout_paise).toBe('0');
      await expect(repo.fleetReport(ids[2]!, 'driver', '2026-10')).rejects.toMatchObject({
        statusCode: 400,
      });
    });
    it('generates six numeric digits bound to one eligible Driver; rotation and wrong-driver access fail safely', async () => {
      const profiles = [];
      for (const user of [ids[2], ids[3]]) {
        const id = (
          await pool.query(
            "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status) VALUES($1,$2,CURRENT_DATE+365,'approved') RETURNING id",
            [user, randomUUID()],
          )
        ).rows[0].id;
        profiles.push(id);
        await pool.query(
          'INSERT INTO partner_drivers(partner_id,driver_profile_id) VALUES($1,$2)',
          [partner, id],
        );
      }
      [profile, otherProfile] = profiles;
      vehicle = (
        await pool.query(
          "INSERT INTO vehicles(owner_id,make,model,plate_number,verification_status,is_active) VALUES($1,'TEST_SAMPLE','Car',$2,'approved',TRUE) RETURNING id",
          [ids[1], randomUUID().slice(0, 18)],
        )
      ).rows[0].id;
      const a = await fleet.generateAssignmentCode(ids[1]!, vehicle, profile);
      expect(a.code).toMatch(/^\d{6}$/);
      expect(await drivers.verifyAssignmentCode(a.code, ids[3]!)).toBe(null);
      expect(await drivers.verifyAssignmentCode(a.code, ids[2]!)).not.toBe(null);
      await expect(drivers.claimAssignmentCode(a.code, ids[3]!, otherProfile)).rejects.toThrow(
        'ASSIGNMENT_CODE_INVALID',
      );
      const b = await fleet.generateAssignmentCode(ids[1]!, vehicle, profile);
      expect(b.code).not.toBe(a.code);
      expect(await drivers.verifyAssignmentCode(a.code, ids[2]!)).toBe(null);
      const claims = await Promise.allSettled([
        drivers.claimAssignmentCode(b.code, ids[2]!, profile),
        drivers.claimAssignmentCode(b.code, ids[2]!, profile),
      ]);
      expect(claims.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
      // Concurrent retry confirms the same persisted assignment, never a second one.
      expect(claims.map((x) => x.status === 'fulfilled' && x.value.vehicleId)).toEqual([
        vehicle,
        vehicle,
      ]);
      expect(
        (await pool.query('SELECT driver_profile_id FROM vehicles WHERE id=$1', [vehicle])).rows[0]
          .driver_profile_id,
      ).toBe(profile);
      await fleet.unassignDriver(ids[1]!, vehicle);
      expect(await drivers.verifyAssignmentCode(b.code, ids[2]!)).toBe(null);
    });
    it('does not expose another Drivers completed-trip totals through Driver-owned historical vehicles', async () => {
      const historicalVehicle = (
        await pool.query(
          "INSERT INTO vehicles(owner_id,driver_profile_id,make,model,plate_number,verification_status,is_active) VALUES($1,$2,'TEST_SAMPLE','Historical',$3,'approved',TRUE) RETURNING id",
          [ids[2], otherProfile, randomUUID().slice(0, 18)],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO rides(customer_id,assigned_driver_id,assigned_vehicle_id,pickup_location,destination_location,status,completed_at,final_fare) VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography,ST_SetSRID(ST_MakePoint(85.2,25.7),4326)::geography,'completed',NOW(),123)",
        [ids[7], otherProfile, historicalVehicle],
      );
      const operations = new PostgresProviderOperationsRepository(pool);
      await expect(operations.earnings(ids[2]!, 'driver')).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(operations.earnings(ids[3]!, 'driver')).rejects.toMatchObject({
        statusCode: 403,
      });
    });
    it('stores an optional account photo without inventing a driver profile or exposing another account photo', async () => {
      await repo.savePhoto(ids[2]!, 'driver', {
        storageProvider: 'cloudinary',
        storageKey: 'TEST_SAMPLE/profile',
        resourceType: 'image',
        accessMode: 'authenticated',
      });
      expect((await repo.photo(ids[2]!, 'driver')).storageKey).toBe('TEST_SAMPLE/profile');
      expect(await repo.photo(ids[3]!, 'driver')).toBe(null);
      expect(
        (await repo.state(ids[2]!, 'driver', { step: 'profile_photo', skipped: false })).progress
          .profile_photo,
      ).toBe('completed');
    });
    it('adds a combined-role Driver without imposing a mandatory onboarding code', async () => {
      const invite = await repo.addDriver(ids[1]!, 'fleet_owner', ids[4] + '@example.invalid');
      expect(invite.code).toBe(null);
      expect(invite.status).toBe('PENDING_ASSOCIATION');
      expect((await repo.state(ids[4]!, 'driver_fleet_owner')).codeVerified).toBe(false);
    });
    it('permits initial role selection exactly once and preserves existing account roles', async () => {
      await pool.query(
        'INSERT INTO provider_onboarding(user_id,role_selection_pending) VALUES($1,TRUE)',
        [ids[6]],
      );
      await repo.selectRole(ids[6]!, 'driver', 'fleet_owner');
      expect((await pool.query('SELECT role FROM users WHERE id=$1', [ids[6]])).rows[0].role).toBe(
        'fleet_owner',
      );
      await expect(repo.selectRole(ids[6]!, 'fleet_owner', 'driver')).rejects.toMatchObject({
        statusCode: 409,
      });
      await expect(repo.selectRole(ids[2]!, 'driver', 'fleet_owner')).rejects.toMatchObject({
        statusCode: 409,
      });
    });
  },
);
