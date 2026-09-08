import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { RideService } from '../services/ride.service.js';

const databaseEnabled = process.env.RIDE_DB_TESTS === 'true';
const describeDatabase = databaseEnabled ? describe : describe.skip;
const repository = new PostgresRideRepository(pool);
const driverRepository = new PostgresDriverRepository(pool);
const service = new RideService(repository, driverRepository);

interface Fixture {
  rideIds: string[];
  customerId: string;
  driverUserId: string;
  driverProfileId: string;
  vehicleId: string;
}

async function createFixture(rideCount = 1): Promise<Fixture> {
  const suffix = randomUUID();
  const customer = await pool.query<{ id: string }>(
    `INSERT INTO users (first_name, last_name, phone, role)
     VALUES ('Ride', 'Customer', $1, 'customer') RETURNING id`,
    [`+91${suffix.replaceAll('-', '').slice(0, 10)}`],
  );
  const driver = await pool.query<{ id: string }>(
    `INSERT INTO users (first_name, last_name, phone, role)
     VALUES ('Ride', 'Driver', $1, 'driver') RETURNING id`,
    [`+92${suffix.replaceAll('-', '').slice(0, 10)}`],
  );
  const profile = await pool.query<{ id: string }>(
    `INSERT INTO driver_profiles
       (user_id, license_number, license_expiry, verification_status)
     VALUES ($1, $2, CURRENT_DATE + 365, 'approved') RETURNING id`,
    [driver.rows[0]!.id, `LIC-${suffix}`],
  );
  const vehicle = await pool.query<{ id: string }>(
    `INSERT INTO vehicles (driver_profile_id, make, model, plate_number)
     VALUES ($1, 'Test', 'Vehicle', $2) RETURNING id`,
    [profile.rows[0]!.id, `P-${suffix.replaceAll('-', '').slice(0, 15)}`],
  );
  await pool.query(
    `UPDATE driver_profiles
     SET availability_status = 'available',
         last_location = ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography,
         last_location_at = NOW()
     WHERE id = $1`,
    [profile.rows[0]!.id],
  );
  const rides: string[] = [];
  for (let index = 0; index < rideCount; index += 1) {
    const ride = await pool.query<{ id: string }>(
      `INSERT INTO rides
         (customer_id, pickup_location, destination_location)
       VALUES ($1, ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography,
          ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography)
       RETURNING id`,
      [customer.rows[0]!.id],
    );
    rides.push(ride.rows[0]!.id);
    await pool.query(`UPDATE rides SET status = 'searching' WHERE id = $1`, [rides[index]]);
  }
  return {
    rideIds: rides,
    customerId: customer.rows[0]!.id,
    driverUserId: driver.rows[0]!.id,
    driverProfileId: profile.rows[0]!.id,
    vehicleId: vehicle.rows[0]!.id,
  };
}

async function cleanFixture(fixture: Fixture): Promise<void> {
  await pool.query('DELETE FROM rides WHERE id = ANY($1::uuid[])', [fixture.rideIds]);
  await pool.query('DELETE FROM vehicles WHERE id = $1', [fixture.vehicleId]);
  await pool.query('DELETE FROM driver_profiles WHERE id = $1', [fixture.driverProfileId]);
  await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [
    fixture.customerId,
    fixture.driverUserId,
  ]);
}

describeDatabase('ride PostgreSQL integration', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterAll(async () => {
    if (fixture) await cleanFixture(fixture);
  });

  it('allows exactly one winner in 100 concurrent acceptance attempts', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!),
      ),
    );
    const successful = results.filter((result) => result.status === 'fulfilled');
    const final = await pool.query<{ status: string; assigned_driver_id: string | null }>(
      `SELECT status, assigned_driver_id FROM rides WHERE id = $1`,
      [fixture.rideIds[0]],
    );
    expect(successful).toHaveLength(1);
    expect(final.rows[0]).toMatchObject({
      status: 'driver_assigned',
      assigned_driver_id: fixture.driverProfileId,
    });
    const driver = await pool.query<{ availability_status: string }>(
      `SELECT availability_status FROM driver_profiles WHERE id = $1`,
      [fixture.driverProfileId],
    );
    expect(driver.rows[0]!.availability_status).toBe('busy');
  });

  it('allows one driver to win only one competing ride', async () => {
    await cleanFixture(fixture);
    fixture = await createFixture(2);
    const results = await Promise.allSettled(
      fixture.rideIds.map((rideId) => service.acceptRide(fixture.driverProfileId, rideId)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const assigned = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM rides
       WHERE assigned_driver_id = $1 AND status = 'driver_assigned'`,
      [fixture.driverProfileId],
    );
    expect(assigned.rows[0]!.count).toBe('1');
  });

  it('makes duplicate cancellation converge on one cancelled state', async () => {
    await cleanFixture(fixture);
    fixture = await createFixture();
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        service.cancelRide(fixture.customerId, fixture.rideIds[0]!, { reason: 'duplicate test' }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const final = await pool.query<{ status: string }>(`SELECT status FROM rides WHERE id = $1`, [
      fixture.rideIds[0],
    ]);
    expect(final.rows[0]!.status).toBe('cancelled');
  });

  it('rejects invalid lifecycle transitions without changing the row', async () => {
    await expect(service.transitionRide(fixture.rideIds[0]!, 'completed')).rejects.toMatchObject({
      code: 'RIDE_TRANSITION_CONFLICT',
    });
    const final = await pool.query<{ status: string }>(`SELECT status FROM rides WHERE id = $1`, [
      fixture.rideIds[0],
    ]);
    expect(final.rows[0]!.status).toBe('searching');
  });
});
