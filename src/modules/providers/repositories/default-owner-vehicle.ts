import type { PoolClient } from 'pg';
import { driverOperationalEligibilitySql } from '../../rides/repositories/driver-eligibility.js';

// A Fleet-only account has no Driver profile to assign. Combined accounts
// select only their own first persisted vehicle, never an arbitrary managed Driver.
export async function assignFirstOwnerVehicle(client: PoolClient, userId: string) {
  const candidate = (
    await client.query<{ id: string }>(
      `SELECT v.id FROM vehicles v
     JOIN driver_profiles dp ON dp.user_id=$1
     JOIN users u ON u.id=dp.user_id
     JOIN partners p ON p.user_id=u.id AND p.approval_status='approved'
     WHERE u.role='driver_fleet_owner' AND v.owner_id=u.id
       AND v.id=(SELECT first_vehicle.vehicle_id FROM owner_first_vehicle_assignments first_vehicle
         WHERE first_vehicle.owner_id=u.id)
       AND dp.active_vehicle_id IS NULL AND dp.availability_status<>'busy'
       AND v.driver_profile_id IS NULL AND ${driverOperationalEligibilitySql(true)}
       AND NOT EXISTS(SELECT 1 FROM rentals r WHERE r.vehicle_id=v.id
         AND (r.status='ACTIVE' OR (r.status IN ('PENDING','CONFIRMED') AND r.start_at<=NOW() AND r.end_at>NOW())))
       AND NOT EXISTS(SELECT 1 FROM rides r WHERE (r.assigned_driver_id=dp.id OR r.assigned_vehicle_id=v.id)
         AND r.status NOT IN ('completed','cancelled'))
       AND NOT EXISTS(SELECT 1 FROM rides r WHERE r.dispatch_driver_id=dp.id AND r.status='searching'
         AND r.dispatch_expires_at>NOW())
       AND NOT EXISTS(SELECT 1 FROM vehicles assigned WHERE assigned.driver_profile_id=dp.id)
       AND NOT EXISTS(SELECT 1 FROM provider_vehicle_association_history h
         WHERE h.driver_profile_id=dp.id OR h.previous_driver_profile_id=dp.id)
     ORDER BY v.created_at,v.id LIMIT 1`,
      [userId],
    )
  ).rows[0];
  if (!candidate) return;
  // Match manual assignment's vehicle -> profile lock order. A concurrent
  // mutation can finish first; the next authenticated refresh retries safely.
  const locked = (
    await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('provider_vehicle:'||$1::text,0)) AS ok",
      [candidate.id],
    )
  ).rows[0]?.ok;
  if (!locked) return;
  const driver = (
    await client.query<{ id: string }>(
      `SELECT id FROM driver_profiles WHERE user_id=$1 AND active_vehicle_id IS NULL
     AND availability_status<>'busy' FOR UPDATE SKIP LOCKED`,
      [userId],
    )
  ).rows[0];
  if (!driver) return;
  const eligible = await client.query(
    `SELECT v.id FROM vehicles v JOIN driver_profiles dp ON dp.id=$2 JOIN users u ON u.id=dp.user_id
     JOIN partners p ON p.user_id=u.id AND p.approval_status='approved'
     WHERE v.id=$1 AND v.owner_id=u.id AND u.role='driver_fleet_owner'
       AND v.id=(SELECT first_vehicle.vehicle_id FROM owner_first_vehicle_assignments first_vehicle
         WHERE first_vehicle.owner_id=u.id)
       AND v.driver_profile_id IS NULL AND dp.active_vehicle_id IS NULL
       AND ${driverOperationalEligibilitySql(true)}
       AND NOT EXISTS(SELECT 1 FROM rentals r WHERE r.vehicle_id=v.id
         AND (r.status='ACTIVE' OR (r.status IN ('PENDING','CONFIRMED') AND r.start_at<=NOW() AND r.end_at>NOW())))
       AND NOT EXISTS(SELECT 1 FROM rides r WHERE (r.assigned_driver_id=dp.id OR r.assigned_vehicle_id=v.id)
         AND r.status NOT IN ('completed','cancelled'))
       AND NOT EXISTS(SELECT 1 FROM rides r WHERE r.dispatch_driver_id=dp.id AND r.status='searching'
         AND r.dispatch_expires_at>NOW())
       AND NOT EXISTS(SELECT 1 FROM vehicles assigned WHERE assigned.driver_profile_id=dp.id)
       AND NOT EXISTS(SELECT 1 FROM provider_vehicle_association_history h
         WHERE h.driver_profile_id=dp.id OR h.previous_driver_profile_id=dp.id)
     FOR UPDATE OF v`,
    [candidate.id, driver.id],
  );
  if (!eligible.rowCount) return;
  // Combined owners are their own fleet's Driver, using the existing profile.
  // Establish the canonical membership so Fleet views and later code claims agree.
  await client.query(
    `INSERT INTO partner_drivers(partner_id,driver_profile_id)
     SELECT id,$2 FROM partners WHERE user_id=$1 AND approval_status='approved'
     ON CONFLICT(partner_id,driver_profile_id) DO NOTHING`,
    [userId, driver.id],
  );
  await client.query('UPDATE vehicles SET driver_profile_id=$2,updated_at=NOW() WHERE id=$1', [
    candidate.id,
    driver.id,
  ]);
  await client.query(
    "UPDATE driver_profiles SET active_vehicle_id=$2,availability_status='unavailable',updated_at=NOW() WHERE id=$1",
    [driver.id, candidate.id],
  );
  await client.query(
    "UPDATE provider_onboarding SET flow_steps=jsonb_set(flow_steps,'{vehicle_assignment}',to_jsonb('completed'::text)),updated_at=NOW() WHERE user_id=$1",
    [userId],
  );
}
