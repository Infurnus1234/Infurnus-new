import { randomUUID } from 'node:crypto';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { createFleetVehicleSchema } from '../../fleet/schemas/fleet.schemas.js';
const fleet = new PostgresFleetRepository(pool);
export async function actor(role: string) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Fleet',$2,$3)",
    [id, id + '@example.invalid', role],
  );
  return id;
}
export async function fixture() {
  await pool.query(
    "INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise) VALUES('TEST_SAMPLE Sedan','sedan','passenger',100,100),('TEST_SAMPLE Goods','mini_truck','logistics',100,100) ON CONFLICT(code) DO NOTHING",
  );
  const admin = await actor('admin'),
    owner = await actor('fleet_owner'),
    driver = await actor('driver');
  const partner = (
    await pool.query(
      "INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_SAMPLE Fleet') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE partners SET approval_status='under_review',reviewed_by=$2,reviewed_at=NOW() WHERE id=$1",
    [partner, admin],
  );
  await pool.query(
    "UPDATE partners SET approval_status='approved',approved_by=$2,approved_at=NOW() WHERE id=$1",
    [partner, admin],
  );
  const profile = (
    await pool.query(
      "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,verified_by,verified_at) VALUES($1,$2,CURRENT_DATE+365,'approved',$3,NOW()) RETURNING id",
      [driver, 'TEST-' + driver, admin],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO partner_drivers(partner_id,driver_profile_id) VALUES($1,$2)', [
    partner,
    profile,
  ]);
  const vehicle = await fleet.createVehicle(
    owner,
    createFleetVehicleSchema.parse({
      make: 'TEST_SAMPLE',
      model: 'Fleet',
      plateNumber: randomUUID().slice(0, 20),
      sector: 'passenger',
      category: 'sedan',
    }),
  );
  await pool.query(
    "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW(),is_active=TRUE WHERE id=$1",
    [vehicle.id, admin],
  );
  return { admin, owner, driver, partner, profile, vehicle, code: vehicle.activeAssignmentCode! };
}
