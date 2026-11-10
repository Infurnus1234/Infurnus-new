import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fixture } from './fleet-workflow-fixture.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { RoleEnrolmentRepository } from '../repositories/role-enrolment.repository.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { createFleetVehicleSchema } from '../../fleet/schemas/fleet.schemas.js';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { signAccessToken } from '../../auth/utils/jwt.js';

const drivers = new PostgresDriverRepository(pool);
const fleet = new PostgresFleetRepository(pool);
const enrolment = new RoleEnrolmentRepository(pool);
const operations = new PostgresProviderOperationsRepository(pool);

async function combined() {
  const f = await fixture();
  await pool.query("UPDATE users SET role='driver_fleet_owner' WHERE id=$1", [f.owner]);
  const profile = (
    await pool.query(
      `INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,verified_by,verified_at)
     VALUES($1,$2,'2090-01-01','approved',$3,NOW()) RETURNING id`,
      [f.owner, 'TEST-' + randomUUID(), f.admin],
    )
  ).rows[0].id as string;
  return { ...f, ownerProfile: profile };
}
async function second(f: Awaited<ReturnType<typeof fixture>>) {
  return fleet.createVehicle(
    f.owner,
    createFleetVehicleSchema.parse({
      make: 'TEST_SAMPLE',
      model: 'Second',
      plateNumber: randomUUID().slice(0, 20),
      sector: 'passenger',
      category: 'sedan',
    }),
  );
}

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Default owner vehicle and live owner details',
  () => {
    it('records first creation without a code, waits for approval, and never replaces it on later creation', async () => {
      const f = await combined();
      // Fresh combined account: fixture's fleet-only vehicle is test setup only.
      await pool.query('DELETE FROM owner_first_vehicle_assignments WHERE owner_id=$1', [f.owner]);
      await pool.query('DELETE FROM vehicles WHERE id=$1', [f.vehicle.id]);
      const first = await second(f);
      expect(await drivers.getAssignedVehicle(f.ownerProfile)).toBeNull();
      expect(
        (
          await pool.query(
            'SELECT vehicle_id FROM owner_first_vehicle_assignments WHERE owner_id=$1',
            [f.owner],
          )
        ).rows[0].vehicle_id,
      ).toBe(first.id);
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1",
        [first.id, f.admin],
      );
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', first.id, {
        operationalStatus: 'ACTIVE',
      });
      expect((await drivers.getAssignedVehicle(f.ownerProfile))?.id).toBe(first.id);
      const next = await second(f);
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1",
        [next.id, f.admin],
      );
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', next.id, {
        operationalStatus: 'ACTIVE',
      });
      expect((await drivers.getAssignedVehicle(f.ownerProfile))?.id).toBe(first.id);
      expect((await fleet.listDrivers(f.owner)).some((d) => d.id === f.ownerProfile)).toBe(true);
      await expect(
        drivers.claimAssignmentCode(next.activeAssignmentCode!, f.owner, f.ownerProfile),
      ).rejects.toThrow('DRIVER_ALREADY_ASSIGNED');
      await fleet.unassignDriver(f.owner, first.id);
      expect(
        (await drivers.claimAssignmentCode(next.activeAssignmentCode!, f.owner, f.ownerProfile))
          .vehicleId,
      ).toBe(next.id);
      expect(
        (await drivers.claimAssignmentCode(next.activeAssignmentCode!, f.owner, f.ownerProfile))
          .vehicleId,
      ).toBe(next.id);
      expect(
        (await pool.query('SELECT id FROM vehicles WHERE driver_profile_id=$1', [f.ownerProfile]))
          .rows,
      ).toEqual([{ id: next.id }]);
    });
    it('elects only one first vehicle under simultaneous creation and does not promote an eligible second vehicle', async () => {
      const f = await combined();
      await pool.query('DELETE FROM owner_first_vehicle_assignments WHERE owner_id=$1', [f.owner]);
      await pool.query('DELETE FROM vehicles WHERE id=$1', [f.vehicle.id]);
      const created = await Promise.all([second(f), second(f)]);
      const intent = (
        await pool.query(
          'SELECT vehicle_id FROM owner_first_vehicle_assignments WHERE owner_id=$1',
          [f.owner],
        )
      ).rows;
      expect(intent).toHaveLength(1);
      const first = created.find((v) => v.id === intent[0].vehicle_id)!;
      const next = created.find((v) => v.id !== first.id)!;
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1",
        [next.id, f.admin],
      );
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', next.id, {
        operationalStatus: 'ACTIVE',
      });
      expect(await drivers.getAssignedVehicle(f.ownerProfile)).toBeNull();
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1",
        [first.id, f.admin],
      );
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', first.id, {
        operationalStatus: 'ACTIVE',
      });
      await Promise.all([
        enrolment.state(f.owner, 'driver_fleet_owner'),
        enrolment.state(f.owner, 'driver_fleet_owner'),
      ]);
      expect(
        (await pool.query('SELECT id FROM vehicles WHERE driver_profile_id=$1', [f.ownerProfile]))
          .rows,
      ).toEqual([{ id: first.id }]);
    });
    it('keeps duplicate submissions from duplicating first-vehicle intent and never promotes after deletion', async () => {
      const f = await combined();
      const next = await second(f);
      await fleet.createVehicle(
        f.owner,
        createFleetVehicleSchema.parse({
          make: 'TEST_SAMPLE',
          model: 'Duplicate',
          plateNumber: next.plateNumber,
          sector: 'passenger',
          category: 'sedan',
        }),
      );
      expect(await fleet.listVehicles(f.owner)).toHaveLength(3);
      expect(
        (
          await pool.query(
            'SELECT vehicle_id FROM owner_first_vehicle_assignments WHERE owner_id=$1',
            [f.owner],
          )
        ).rows,
      ).toEqual([{ vehicle_id: f.vehicle.id }]);
      await pool.query('DELETE FROM vehicles WHERE id=$1', [f.vehicle.id]);
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1",
        [next.id, f.admin],
      );
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', next.id, {
        operationalStatus: 'ACTIVE',
      });
      await enrolment.state(f.owner, 'driver_fleet_owner');
      expect(await drivers.getAssignedVehicle(f.ownerProfile)).toBeNull();
      expect(
        (
          await pool.query(
            'SELECT vehicle_id FROM owner_first_vehicle_assignments WHERE owner_id=$1',
            [f.owner],
          )
        ).rows,
      ).toEqual([{ vehicle_id: null }]);
    });
    it('rejects combined vehicle creation with a precise missing-profile reason and rolls back', async () => {
      const f = await fixture();
      await pool.query("UPDATE users SET role='driver_fleet_owner' WHERE id=$1", [f.owner]);
      await expect(second(f)).rejects.toMatchObject({ code: 'DRIVER_PROFILE_MISSING' });
      expect((await fleet.listVehicles(f.owner)).map((v) => v.id)).toEqual([f.vehicle.id]);
    });
    it('permits combined own-vehicle selection in Fleet mode over HTTP and preserves role restrictions', async () => {
      const f = await combined(),
        other = await fixture();
      const app = createApp(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        new PostgresRideRepository(pool),
        drivers,
      );
      const authorization =
        'Bearer ' +
        (await signAccessToken({ sub: f.owner, role: 'driver_fleet_owner', type: 'access' }));
      const select = () =>
        request(app)
          .post('/rides/driver/active-vehicle')
          .set('authorization', authorization)
          .set('X-Provider-Mode', 'fleet_owner');
      const saved = await select().send({ vehicleId: f.vehicle.id });
      expect(saved.status, saved.text).toBe(200);
      expect((await select().send({ vehicleId: f.vehicle.id })).status).toBe(200);
      expect((await select().send({ vehicleId: 'invalid' })).status).toBe(400);
      expect((await select().send({ vehicleId: randomUUID() })).status).toBe(400);
      expect((await select().send({ vehicleId: other.vehicle.id })).status).toBe(400);
      const freshAuthorization =
        'Bearer ' +
        (await signAccessToken({ sub: f.owner, role: 'driver_fleet_owner', type: 'access' }));
      const read = await request(app)
        .get('/rides/driver/assigned-vehicle')
        .set('authorization', freshAuthorization)
        .set('X-Provider-Mode', 'driver');
      expect(read.status, read.text).toBe(200);
      expect(read.body.data).toMatchObject({
        id: f.vehicle.id,
        owner: { id: f.owner, businessName: 'TEST_SAMPLE Fleet' },
      });
      const fleetOnly =
        'Bearer ' +
        (await signAccessToken({ sub: other.owner, role: 'fleet_owner', type: 'access' }));
      expect(
        (
          await request(app)
            .post('/rides/driver/active-vehicle')
            .set('authorization', fleetOnly)
            .send({ vehicleId: other.vehicle.id })
        ).status,
      ).toBe(403);
      await fleet.unassignDriver(f.owner, f.vehicle.id);
      const cleared = await request(app)
        .get('/rides/driver/assigned-vehicle')
        .set('authorization', freshAuthorization)
        .set('X-Provider-Mode', 'driver');
      expect(cleared.status, cleared.text).toBe(404);
      expect(cleared.body.error.code).toBe('NO_ASSIGNED_VEHICLE');
    });
    it('does not auto-select a vehicle when configured required evidence is missing', async () => {
      const f = await combined();
      const code = 'test_' + randomUUID().replaceAll('-', '').slice(0, 20);
      const rule = (
        await pool.query(
          `INSERT INTO provider_document_requirements(provider_role,vehicle_category,document_code,required,updated_by)
        VALUES('driver_fleet_owner','sedan',$1,TRUE,$2) RETURNING id`,
          [code, f.admin],
        )
      ).rows[0].id;
      try {
        await enrolment.state(f.owner, 'driver_fleet_owner');
        expect(await drivers.getAssignedVehicle(f.ownerProfile)).toBeNull();
      } finally {
        await pool.query('DELETE FROM provider_document_requirements WHERE id=$1', [rule]);
      }
      await enrolment.state(f.owner, 'driver_fleet_owner');
      expect((await drivers.getAssignedVehicle(f.ownerProfile))?.id).toBe(f.vehicle.id);
    });
    it('selects the first eligible vehicle once, persists, unassigns and switches without duplicate assignment', async () => {
      const f = await combined(),
        next = await second(f);
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', f.vehicle.id, {
        operationalStatus: 'ACTIVE',
      });
      expect((await drivers.getAssignedVehicle(f.ownerProfile))?.id).toBe(f.vehicle.id);
      expect((await enrolment.state(f.owner, 'driver_fleet_owner')).assignmentStatus).toBe(
        'assigned',
      );
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1",
        [next.id, f.admin],
      );
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', next.id, {
        operationalStatus: 'ACTIVE',
      });
      expect((await drivers.getAssignedVehicle(f.ownerProfile))?.id).toBe(f.vehicle.id);
      await fleet.unassignDriver(f.owner, f.vehicle.id);
      expect((await enrolment.state(f.owner, 'driver_fleet_owner')).assignmentStatus).toBe(
        'unassigned',
      );
      expect(await drivers.getAssignedVehicle(f.ownerProfile)).toBeNull();
      expect(await drivers.setActiveVehicle(f.ownerProfile, next.id)).toBe(true);
      expect(await drivers.setActiveVehicle(f.ownerProfile, next.id)).toBe(true);
      expect(
        (await new PostgresDriverRepository(pool).getAssignedVehicle(f.ownerProfile))?.id,
      ).toBe(next.id);
      expect(
        (await pool.query('SELECT id FROM vehicles WHERE driver_profile_id=$1', [f.ownerProfile]))
          .rows,
      ).toEqual([{ id: next.id }]);
    });
    it('does not assign pending, rejected, inactive or foreign vehicles and retries when eligible', async () => {
      const f = await combined(),
        foreign = await fixture();
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', f.vehicle.id, {
        operationalStatus: 'INACTIVE',
      });
      await enrolment.state(f.owner, 'driver_fleet_owner');
      expect(await drivers.getAssignedVehicle(f.ownerProfile)).toBeNull();
      const pending = await second(f);
      await expect(
        operations.manageVehicle(f.owner, 'driver_fleet_owner', pending.id, {
          operationalStatus: 'ACTIVE',
        }),
      ).rejects.toMatchObject({ code: 'VEHICLE_NOT_ELIGIBLE' });
      await pool.query("UPDATE vehicles SET verification_status='rejected' WHERE id=$1", [
        pending.id,
      ]);
      expect(await drivers.setActiveVehicle(f.ownerProfile, pending.id)).toBe(false);
      expect(await drivers.setActiveVehicle(f.ownerProfile, foreign.vehicle.id)).toBe(false);
      expect(await drivers.setActiveVehicle(f.ownerProfile, randomUUID())).toBe(false);
      await operations.manageVehicle(f.owner, 'driver_fleet_owner', f.vehicle.id, {
        operationalStatus: 'ACTIVE',
      });
      expect((await drivers.getAssignedVehicle(f.ownerProfile))?.id).toBe(f.vehicle.id);
    });
    it('waits for Driver and business approval without bypassing configured compliance', async () => {
      const f = await combined();
      await pool.query("UPDATE driver_profiles SET verification_status='pending' WHERE id=$1", [
        f.ownerProfile,
      ]);
      await enrolment.state(f.owner, 'driver_fleet_owner');
      expect(await drivers.getAssignedVehicle(f.ownerProfile)).toBeNull();
      await pool.query(
        "UPDATE driver_profiles SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1",
        [f.ownerProfile, f.admin],
      );
      await pool.query("UPDATE partners SET approval_status='under_review' WHERE id=$1", [
        f.partner,
      ]);
      await enrolment.state(f.owner, 'driver_fleet_owner');
      expect(await drivers.getAssignedVehicle(f.ownerProfile)).toBeNull();
      await pool.query(
        "UPDATE partners SET approval_status='approved',approved_by=$2,approved_at=NOW() WHERE id=$1",
        [f.partner, f.admin],
      );
      await enrolment.state(f.owner, 'driver_fleet_owner');
      expect((await drivers.getAssignedVehicle(f.ownerProfile))?.id).toBe(f.vehicle.id);
    });
    it('serializes competing default selection and manual requests', async () => {
      const f = await combined();
      await Promise.all([
        enrolment.state(f.owner, 'driver_fleet_owner'),
        enrolment.state(f.owner, 'driver_fleet_owner'),
        drivers.setActiveVehicle(f.ownerProfile, f.vehicle.id),
      ]);
      expect((await drivers.getAssignedVehicle(f.ownerProfile))?.id).toBe(f.vehicle.id);
      expect(
        (await pool.query('SELECT id FROM vehicles WHERE driver_profile_id=$1', [f.ownerProfile]))
          .rowCount,
      ).toBe(1);
    });
    it('reads current owner contacts from vehicle ownership, clears on unassignment, and denies unrelated membership', async () => {
      const f = await fixture();
      await drivers.claimAssignmentCode(f.code, f.driver, f.profile);
      const owner = await drivers.getAssignedVehicle(f.profile);
      expect(owner?.owner).toMatchObject({
        id: f.owner,
        name: 'TEST_SAMPLE Fleet',
        businessName: 'TEST_SAMPLE Fleet',
      });
      await pool.query(
        "UPDATE users SET first_name='Updated',phone='+919876543210',email=$2 WHERE id=$1",
        [f.owner, randomUUID() + '@example.invalid'],
      );
      expect((await drivers.getAssignedVehicle(f.profile))?.owner).toMatchObject({
        id: f.owner,
        name: 'Updated Fleet',
        phone: '+919876543210',
      });
      const other = await fixture();
      await pool.query('UPDATE vehicles SET owner_id=$2 WHERE id=$1', [f.vehicle.id, other.owner]);
      expect(await drivers.getAssignedVehicle(f.profile)).toBeNull();
      await pool.query('INSERT INTO partner_drivers(partner_id,driver_profile_id) VALUES($1,$2)', [
        other.partner,
        f.profile,
      ]);
      expect((await drivers.getAssignedVehicle(f.profile))?.owner?.id).toBe(other.owner);
      await fleet.unassignDriver(other.owner, f.vehicle.id);
      expect(await drivers.getAssignedVehicle(f.profile)).toBeNull();
    });
  },
);
