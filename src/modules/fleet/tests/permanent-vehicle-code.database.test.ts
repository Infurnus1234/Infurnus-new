import { describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { fixture } from '../../providers/tests/fleet-workflow-fixture.js';
import { PostgresFleetRepository } from '../repositories/fleet.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'permanent vehicle identity and assignment',
  () => {
    const fleet = new PostgresFleetRepository(pool),
      drivers = new PostgresDriverRepository(pool);
    it('reopens, edits, refreshes and concurrently retrieves one code without adding vehicles or tokens', async () => {
      const f = await fixture();
      const count = (await pool.query('SELECT count(*)::int n FROM vehicles')).rows[0].n;
      const codes = await Promise.all([
        fleet.generateAssignmentCode(f.owner, f.vehicle.id),
        fleet.generateAssignmentCode(f.owner, f.vehicle.id, f.profile),
        fleet.generateAssignmentCode(f.owner, f.vehicle.id),
      ]);
      expect(codes.map((c) => c.code)).toEqual([f.code, f.code, f.code]);
      expect(codes.every((c) => c.permanent)).toBe(true);
      await fleet.updateVehicle(f.owner, f.vehicle.id, { color: 'Blue' });
      const saved = (await fleet.listVehicles(f.owner)).find((v) => v.id === f.vehicle.id);
      expect(saved).toMatchObject({
        vehicleCode: f.code,
        activeAssignmentCode: f.code,
        color: 'Blue',
      });
      expect((await pool.query('SELECT count(*)::int n FROM vehicles')).rows[0].n).toBe(count);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM driver_assignment_codes WHERE vehicle_id=$1',
            [f.vehicle.id],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(
        pool.query("UPDATE vehicles SET joining_code='NEWCODE' WHERE id=$1", [f.vehicle.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('the permanent code survives former token expiry, claim retries, and unassignment', async () => {
      const f = await fixture();
      await pool.query(
        "UPDATE driver_assignment_codes SET expires_at=NOW()-INTERVAL '1 day' WHERE code=$1",
        [f.code],
      );
      expect((await drivers.verifyAssignmentCode(f.code, f.driver))?.vehicle.id).toBe(f.vehicle.id);
      expect((await drivers.claimAssignmentCode(f.code, f.driver, f.profile)).vehicleId).toBe(
        f.vehicle.id,
      );
      expect((await fleet.generateAssignmentCode(f.owner, f.vehicle.id)).code).toBe(f.code);
      expect((await drivers.claimAssignmentCode(f.code, f.driver, f.profile)).vehicleId).toBe(
        f.vehicle.id,
      );
      await fleet.unassignDriver(f.owner, f.vehicle.id);
      expect(
        (await fleet.listVehicles(f.owner)).find((v) => v.id === f.vehicle.id)
          ?.activeAssignmentCode,
      ).toBe(f.code);
      expect((await drivers.claimAssignmentCode(f.code, f.driver, f.profile)).vehicleId).toBe(
        f.vehicle.id,
      );
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM driver_assignment_codes WHERE vehicle_id=$1',
            [f.vehicle.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it('unassignment revokes legacy active tokens before restoring the permanent identity', async () => {
      const f = await fixture();
      await drivers.claimAssignmentCode(f.code, f.driver, f.profile);
      const legacy = 'legacy_' + f.vehicle.id.replaceAll('-', '').slice(0, 12);
      await pool.query(
        "INSERT INTO driver_assignment_codes(code,vehicle_id,fleet_owner_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 day')",
        [legacy, f.vehicle.id, f.owner],
      );
      await fleet.unassignDriver(f.owner, f.vehicle.id);
      expect(
        (await pool.query('SELECT status FROM driver_assignment_codes WHERE code=$1', [legacy]))
          .rows[0].status,
      ).toBe('REVOKED');
      expect((await drivers.claimAssignmentCode(f.code, f.driver, f.profile)).vehicleId).toBe(
        f.vehicle.id,
      );
    });
    it('still rejects cross-Fleet, invalid, busy and duplicate vehicle assignments', async () => {
      const a = await fixture(),
        b = await fixture();
      expect(await drivers.verifyAssignmentCode(a.code, b.driver)).toBeNull();
      await expect(drivers.claimAssignmentCode(a.code, b.driver, b.profile)).rejects.toThrow();
      await expect(fleet.generateAssignmentCode(b.owner, a.vehicle.id)).rejects.toThrow();
      await expect(
        drivers.claimAssignmentCode('999999999999', a.driver, a.profile),
      ).rejects.toThrow();
      await drivers.claimAssignmentCode(a.code, a.driver, a.profile);
      await pool.query("UPDATE driver_profiles SET availability_status='available' WHERE id=$1", [
        a.profile,
      ]);
      await pool.query("UPDATE driver_profiles SET availability_status='busy' WHERE id=$1", [
        a.profile,
      ]);
      await expect(drivers.claimAssignmentCode(a.code, a.driver, a.profile)).rejects.toThrow();
      await pool.query("UPDATE driver_profiles SET availability_status='available' WHERE id=$1", [
        a.profile,
      ]);
      await drivers.claimAssignmentCode(a.code, a.driver, a.profile);
      await expect(drivers.claimAssignmentCode(b.code, a.driver, a.profile)).rejects.toThrow();
      expect((await drivers.getAssignedVehicle(a.profile))?.id).toBe(a.vehicle.id);
    });
  },
);
