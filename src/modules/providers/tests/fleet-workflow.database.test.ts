import { actor, fixture } from './fleet-workflow-fixture.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { RoleEnrolmentRepository } from '../repositories/role-enrolment.repository.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { createFleetVehicleSchema } from '../../fleet/schemas/fleet.schemas.js';

const repo = new RoleEnrolmentRepository(pool);
const fleet = new PostgresFleetRepository(pool);
const drivers = new PostgresDriverRepository(pool);
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Fleet vehicle-code and dashboard authority',
  () => {
    beforeAll(() => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Owned disposable database required');
    });
    it('skip opens dashboard persistently and creates no profile, fleet or vehicle assignment', async () => {
      const user = await actor('driver');
      const state = await repo.state(user, 'driver', { deferSetup: true });
      expect(state.dashboardAccessible).toBe(true);
      expect(state.assignmentStatus).toBe('unassigned');
      expect(state.codeVerified).toBe(false);
      expect((await repo.state(user, 'driver')).dashboardAccessible).toBe(true);
      expect(
        (await pool.query('SELECT id FROM driver_profiles WHERE user_id=$1', [user])).rowCount,
      ).toBe(0);
      expect((await pool.query('SELECT id FROM vehicles WHERE owner_id=$1', [user])).rowCount).toBe(
        0,
      );
    });
    it('creates independent six-digit codes immediately for multiple categories', async () => {
      const { owner, vehicle, code } = await fixture();
      const second = await fleet.createVehicle(
        owner,
        createFleetVehicleSchema.parse({
          make: 'TEST_SAMPLE',
          model: 'Goods',
          plateNumber: randomUUID().slice(0, 20),
          sector: 'logistics',
          category: 'mini_truck',
        }),
      );
      expect(code).toMatch(/^\d{6}$/);
      expect(second.activeAssignmentCode).toMatch(/^\d{6}$/);
      expect(second.activeAssignmentCode).not.toBe(code);
      expect((await fleet.listVehicles(owner)).map((v) => v.id)).toEqual(
        expect.arrayContaining([vehicle.id, second.id]),
      );
    });
    it('valid code persists exactly its vehicle and retry confirms the same assignment', async () => {
      const f = await fixture();
      await repo.state(f.driver, 'driver', { deferSetup: true });
      expect((await drivers.claimAssignmentCode(f.code, f.driver, f.profile)).vehicleId).toBe(
        f.vehicle.id,
      );
      expect((await drivers.claimAssignmentCode(f.code, f.driver, f.profile)).vehicleId).toBe(
        f.vehicle.id,
      );
      expect((await drivers.getAssignedVehicle(f.profile))?.id).toBe(f.vehicle.id);
      expect((await repo.state(f.driver, 'driver')).assignmentStatus).toBe('assigned');
    });
    it('invalid code never assigns a vehicle', async () => {
      const f = await fixture();
      await expect(
        drivers.claimAssignmentCode('not-a-code', f.driver, f.profile),
      ).rejects.toThrow();
      expect(await drivers.getAssignedVehicle(f.profile)).toBeNull();
    });
    it('a code cannot cross fleet boundaries', async () => {
      const a = await fixture(),
        b = await fixture();
      await expect(drivers.claimAssignmentCode(a.code, b.driver, b.profile)).rejects.toThrow();
      expect(await drivers.getAssignedVehicle(b.profile)).toBeNull();
    });
    it('a second vehicle cannot silently replace the Driver current vehicle', async () => {
      const f = await fixture();
      await drivers.claimAssignmentCode(f.code, f.driver, f.profile);
      const second = await fleet.createVehicle(
        f.owner,
        createFleetVehicleSchema.parse({
          make: 'TEST_SAMPLE',
          model: 'Second',
          plateNumber: randomUUID().slice(0, 20),
        }),
      );
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW(),is_active=TRUE WHERE id=$1",
        [second.id, f.admin],
      );
      await expect(
        drivers.claimAssignmentCode(second.activeAssignmentCode!, f.driver, f.profile),
      ).rejects.toThrow('DRIVER_ALREADY_ASSIGNED');
      expect((await drivers.getAssignedVehicle(f.profile))?.id).toBe(f.vehicle.id);
    });
    it('a provisional account must choose its role before skipping', async () => {
      const user = await actor('driver');
      await pool.query(
        'INSERT INTO provider_onboarding(user_id,role_selection_pending) VALUES($1,TRUE)',
        [user],
      );
      await expect(repo.state(user, 'driver', { deferSetup: true })).rejects.toMatchObject({
        statusCode: 409,
      });
    });
    it('serializes competing Drivers so exactly one can claim a vehicle', async () => {
      const a = await fixture(),
        b = await fixture();
      await pool.query('INSERT INTO partner_drivers(partner_id,driver_profile_id) VALUES($1,$2)', [
        a.partner,
        b.profile,
      ]);
      const results = await Promise.allSettled([
        drivers.claimAssignmentCode(a.code, a.driver, a.profile),
        drivers.claimAssignmentCode(a.code, b.driver, b.profile),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const assigned = (
        await pool.query('SELECT driver_profile_id FROM vehicles WHERE id=$1', [a.vehicle.id])
      ).rows[0].driver_profile_id;
      expect([a.profile, b.profile]).toContain(assigned);
      expect(
        (
          await pool.query('SELECT id FROM driver_profiles WHERE active_vehicle_id=$1', [
            a.vehicle.id,
          ])
        ).rows.map((r) => r.id),
      ).toEqual([assigned]);
    });
    it('serializes two vehicle claims by one Driver without replacing an assignment', async () => {
      const f = await fixture();
      const second = await fleet.createVehicle(
        f.owner,
        createFleetVehicleSchema.parse({
          make: 'TEST_SAMPLE',
          model: 'Second',
          plateNumber: randomUUID().slice(0, 20),
        }),
      );
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW(),is_active=TRUE WHERE id=$1",
        [second.id, f.admin],
      );
      const results = await Promise.allSettled([
        drivers.claimAssignmentCode(f.code, f.driver, f.profile),
        drivers.claimAssignmentCode(second.activeAssignmentCode!, f.driver, f.profile),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        (await pool.query('SELECT id FROM vehicles WHERE driver_profile_id=$1', [f.profile]))
          .rowCount,
      ).toBe(1);
    });
    it('rotation revokes the previous code, rejects expired codes, and never exposes owner codes across Fleets', async () => {
      const f = await fixture(),
        other = await fixture();
      const next = await fleet.generateAssignmentCode(f.owner, f.vehicle.id);
      await expect(drivers.claimAssignmentCode(f.code, f.driver, f.profile)).rejects.toThrow(
        'ASSIGNMENT_CODE_INVALID',
      );
      await expect(fleet.generateAssignmentCode(other.owner, f.vehicle.id)).rejects.toThrow();
      expect(
        (await fleet.listVehicles(other.owner)).some((v) => v.activeAssignmentCode === next.code),
      ).toBe(false);
      await pool.query(
        "UPDATE driver_assignment_codes SET expires_at=NOW()-INTERVAL '1 day' WHERE code=$1",
        [next.code],
      );
      await expect(drivers.claimAssignmentCode(next.code, f.driver, f.profile)).rejects.toThrow(
        'ASSIGNMENT_CODE_INVALID',
      );
      expect(await drivers.getAssignedVehicle(f.profile)).toBeNull();
    });
    it('allows configured rental inventory and rejects a mismatched sector/type', async () => {
      const f = await fixture();
      const rental = await fleet.createVehicle(
        f.owner,
        createFleetVehicleSchema.parse({
          make: 'TEST_SAMPLE',
          model: 'Rental',
          plateNumber: randomUUID().slice(0, 20),
          sector: 'rental',
          category: 'sedan',
        }),
      );
      expect(rental.sector).toBe('rental');
      expect(rental.activeAssignmentCode).toMatch(/^\d{6}$/);
      await expect(
        fleet.createVehicle(
          f.owner,
          createFleetVehicleSchema.parse({
            make: 'TEST_SAMPLE',
            model: 'Wrong',
            plateNumber: randomUUID().slice(0, 20),
            sector: 'logistics',
            category: 'sedan',
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  },
);
