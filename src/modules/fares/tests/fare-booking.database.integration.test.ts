import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../../../infrastructure/database/postgres.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { RideService } from '../../rides/services/ride.service.js';
import { DEFAULT_FARE_PRICING, VEHICLE_FARE_PRICING } from '../config/fare.config.js';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import { FareEstimateService } from '../services/fare-estimate.service.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';

const live = process.env.RIDE_DB_TESTS === 'true' ? describe : describe.skip;
// Only external routing is deterministic; calculation, service and SQL persistence are real.
const routes: MapProvider = {
  calculateRoute: async () => ({ distanceMeters: 10000, durationSeconds: 1200 }),
  calculateMatrix: async () => [],
  geocode: async () => null,
  places: async () => [],
};
const input = {
  pickup: { latitude: 12.9716, longitude: 77.5946 },
  destination: { latitude: 12.9352, longitude: 77.6245 },
  sector: 'passenger' as const,
  vehicleCategory: 'bike',
  waitingMinutes: 3,
  fareEstimate: 1,
};
function estimator(fixed: boolean) {
  return new FareEstimateService(
    routes,
    new FareCalculatorService(
      DEFAULT_FARE_PRICING,
      fixed
        ? {
            passenger: {
              bike: {
                ...VEHICLE_FARE_PRICING.passenger!.bike!,
                fixedRates: { baseFare: 1800, distanceRatePerKm: 600 },
              },
            },
          }
        : VEHICLE_FARE_PRICING,
    ),
  );
}
live('fare-to-booking PostgreSQL persistence and transactions', () => {
  let customerId: string;
  beforeEach(async () => {
    const result = await pool.query<{ id: string }>(
      "INSERT INTO users(first_name,last_name,phone,role) VALUES('Fare','Audit',$1,'customer') RETURNING id",
      [`+95${randomUUID().replaceAll('-', '').slice(0, 10)}`],
    );
    customerId = result.rows[0]!.id;
  });
  afterEach(async () => {
    await pool.query('DELETE FROM rides WHERE customer_id=$1', [customerId]);
    await pool.query('DELETE FROM users WHERE id=$1', [customerId]);
  });
  it('persists the server estimate including waiting and ignores client fare', async () => {
    const fare = estimator(true);
    const estimate = await fare.estimate(input.pickup, input.destination, {
      pricingMode: 'vehicle_range',
      sector: input.sector,
      vehicleCategory: input.vehicleCategory,
      waitingMinutes: 3,
    });
    if (!('estimateType' in estimate) || estimate.estimateType !== 'range' || !estimate.bookingFare)
      throw new Error('Expected test-only configured fixed quote');
    const service = new RideService(new PostgresRideRepository(pool), undefined, undefined, fare);
    const ride = await service.createRide(customerId, input);
    const row = await pool.query('SELECT fare_estimate FROM rides WHERE id=$1', [ride.id]);
    expect(Number(row.rows[0].fare_estimate)).toBe(estimate.bookingFare.grossAmount / 100);
    expect(Number(row.rows[0].fare_estimate)).not.toBe(input.fareEstimate);
    expect((await new PostgresRideRepository(pool).findById(ride.id))?.bookingDistanceMeters).toBe(
      10000,
    );
  });
  it('rejects missing fixed quotes and FTL without inserting rows', async () => {
    const service = new RideService(
      new PostgresRideRepository(pool),
      undefined,
      undefined,
      estimator(false),
    );
    await expect(service.createRide(customerId, input)).rejects.toMatchObject({
      code: 'FARE_FIXED_QUOTE_REQUIRED',
    });
    await expect(
      service.createRide(customerId, { ...input, sector: 'logistics', vehicleCategory: 'ftl' }),
    ).rejects.toMatchObject({ code: 'FARE_FIXED_QUOTE_REQUIRED' });
    const rows = await pool.query('SELECT id FROM rides WHERE customer_id=$1', [customerId]);
    expect(rows.rowCount).toBe(0);
  });
  it('commits successful writes and rolls back writes on failure', async () => {
    await withTransaction(async (client) => {
      await client.query("UPDATE users SET first_name='Committed' WHERE id=$1", [customerId]);
    });
    await expect(
      withTransaction(async (client) => {
        await client.query("UPDATE users SET first_name='RolledBack' WHERE id=$1", [customerId]);
        throw new Error('intentional audit rollback');
      }),
    ).rejects.toThrow('intentional audit rollback');
    const rows = await pool.query('SELECT first_name FROM users WHERE id=$1', [customerId]);
    expect(rows.rows[0].first_name).toBe('Committed');
  });
});
