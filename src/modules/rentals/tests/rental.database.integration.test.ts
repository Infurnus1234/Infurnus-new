import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresRentalRepository } from '../repositories/rental.repository.js';
import { RentalService } from '../services/rental.service.js';

const databaseEnabled = process.env.RENTAL_DB_TESTS === 'true';
const describeDatabase = databaseEnabled ? describe : describe.skip;

const repository = new PostgresRentalRepository(pool);
const service = new RentalService(repository);

interface Fixture {
  userId: string;
  vehicleId: string;
  driverProfileId: string;
  driverUserId: string;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();

  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (first_name, last_name, phone, role)
     VALUES ('Rental', 'Customer', $1, 'customer')
     RETURNING id`,
    [`+91${suffix.replaceAll('-', '').slice(0, 10)}`],
  );

  const driverUser = await pool.query<{ id: string }>(
    `INSERT INTO users (first_name, last_name, phone, role)
     VALUES ('Rental', 'Driver', $1, 'driver')
     RETURNING id`,
    [`+92${suffix.replaceAll('-', '').slice(0, 10)}`],
  );

  const profile = await pool.query<{ id: string }>(
    `INSERT INTO driver_profiles
       (user_id, license_number, license_expiry, verification_status)
     VALUES ($1, $2, CURRENT_DATE + 365, 'approved')
     RETURNING id`,
    [driverUser.rows[0]!.id, `RENTAL-LIC-${suffix}`],
  );

  const vehicle = await pool.query<{ id: string }>(
    `INSERT INTO vehicles
       (driver_profile_id, make, model, plate_number)
     VALUES ($1, 'Rental', 'Test Vehicle', $2)
     RETURNING id`,
    [profile.rows[0]!.id, `R-${suffix.replaceAll('-', '').slice(0, 15)}`],
  );

  return {
    userId: user.rows[0]!.id,
    vehicleId: vehicle.rows[0]!.id,
    driverProfileId: profile.rows[0]!.id,
    driverUserId: driverUser.rows[0]!.id,
  };
}

async function cleanFixture(fixture: Fixture): Promise<void> {
  await pool.query(
    `DELETE FROM rentals
     WHERE user_id = $1
        OR vehicle_id = $2`,
    [fixture.userId, fixture.vehicleId],
  );

  await pool.query(`DELETE FROM vehicles WHERE id = $1`, [fixture.vehicleId]);

  await pool.query(`DELETE FROM driver_profiles WHERE id = $1`, [fixture.driverProfileId]);

  await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [
    fixture.userId,
    fixture.driverUserId,
  ]);
}

const rentalInput = {
  startAt: '2030-01-01T10:00:00+05:30',
  endAt: '2030-01-03T10:00:00+05:30',
  totalAmount: 2500,
  currency: 'INR',
};

describeDatabase('rental PostgreSQL integration', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterAll(async () => {
    if (fixture) {
      await cleanFixture(fixture);
    }
    await pool.end();
  });

  it('creates a rental and prevents an overlapping booking', async () => {
    const first = await service.createRental(
      fixture.userId,
      {
        ...rentalInput,
        vehicleId: fixture.vehicleId,
      },
      `first-${randomUUID()}`,
    );

    expect(first.status).toBe('PENDING');

    await expect(
      service.createRental(
        fixture.userId,
        {
          ...rentalInput,
          vehicleId: fixture.vehicleId,
          startAt: '2030-01-02T10:00:00+05:30',
          endAt: '2030-01-04T10:00:00+05:30',
        },
        `second-${randomUUID()}`,
      ),
    ).rejects.toMatchObject({
      code: 'RENTAL_AVAILABILITY_CONFLICT',
    });
  });

  it('allows adjacent rental periods without overlap', async () => {
    await service.createRental(
      fixture.userId,
      {
        ...rentalInput,
        vehicleId: fixture.vehicleId,
      },
      `first-${randomUUID()}`,
    );

    const second = await service.createRental(
      fixture.userId,
      {
        ...rentalInput,
        vehicleId: fixture.vehicleId,
        startAt: '2030-01-03T10:00:00+05:30',
        endAt: '2030-01-05T10:00:00+05:30',
      },
      `second-${randomUUID()}`,
    );

    expect(second.status).toBe('PENDING');
  });

  it('returns the same rental for an idempotent retry', async () => {
    const key = `retry-${randomUUID()}`;

    const first = await service.createRental(
      fixture.userId,
      {
        ...rentalInput,
        vehicleId: fixture.vehicleId,
      },
      key,
    );

    const retry = await service.createRental(
      fixture.userId,
      {
        ...rentalInput,
        vehicleId: fixture.vehicleId,
      },
      key,
    );

    expect(retry.id).toBe(first.id);

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rentals
       WHERE user_id = $1
         AND idempotency_key = $2`,
      [fixture.userId, key],
    );

    expect(count.rows[0]!.count).toBe('1');
  });

  it('rejects reusing an idempotency key with different details', async () => {
    const key = `conflict-${randomUUID()}`;

    await service.createRental(
      fixture.userId,
      {
        ...rentalInput,
        vehicleId: fixture.vehicleId,
      },
      key,
    );

    await expect(
      service.createRental(
        fixture.userId,
        {
          ...rentalInput,
          vehicleId: fixture.vehicleId,
          startAt: '2030-02-01T10:00:00+05:30',
          endAt: '2030-02-03T10:00:00+05:30',
        },
        key,
      ),
    ).rejects.toMatchObject({
      code: 'RENTAL_IDEMPOTENCY_CONFLICT',
    });
  });

  it('allows exactly one winner across 10 concurrent overlapping bookings', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        service.createRental(
          fixture.userId,
          {
            ...rentalInput,
            vehicleId: fixture.vehicleId,
          },
          `concurrent-${index}-${randomUUID()}`,
        ),
      ),
    );

    const successful = results.filter((result) => result.status === 'fulfilled');

    expect(successful).toHaveLength(1);

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rentals
       WHERE vehicle_id = $1
         AND status IN ('PENDING', 'CONFIRMED', 'ACTIVE')`,
      [fixture.vehicleId],
    );

    expect(count.rows[0]!.count).toBe('1');
  });
});
