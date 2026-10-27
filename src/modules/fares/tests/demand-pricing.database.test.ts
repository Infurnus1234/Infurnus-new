import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { FareEstimateService } from '../services/fare-estimate.service.js';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
import type { VehicleType } from '../../vehicles/types/vehicle.js';
import { demandProvenance } from '../services/demand-pricing.js';
import { vehiclePricingReferenceSchema } from '../../vehicles/schemas/vehicle.schemas.js';
const live = process.env.RIDE_DB_TESTS === 'true' ? describe : describe.skip;
const settings = {
  windowSeconds: 300,
  lowBookingCount: 5,
  highBookingCount: 20,
  staleAfterSeconds: 30,
};
const pricing = {
  displayName: 'TEST ONLY demand fixture',
  baseFare: { minimum: 1500, maximum: 2000 },
  perKmRate: { minimum: 500, maximum: 800 },
  demandPricing: settings,
};
const maps = {
  calculateRoute: async () => ({ distanceMeters: 1000, durationSeconds: 60 }),
} as unknown as MapProvider;
const repo = new PostgresVehicleRepository(pool);
const calc = new FareCalculatorService();
const ownedTypes: string[] = [],
  ownedUsers: string[] = [];
const coords = { latitude: 25.6, longitude: 85.1 };
const input = {
  pickup: coords,
  destination: coords,
  sector: 'passenger' as const,
  vehicleCategory: 'placeholder',
};
async function user(role = 'customer') {
  const r = await pool.query(
    "INSERT INTO users(first_name,last_name,role) VALUES('Pricing','TEST ONLY',$1) RETURNING id",
    [role],
  );
  ownedUsers.push(r.rows[0].id);
  return r.rows[0].id as string;
}
async function type(
  sector: VehicleType['sector'] = 'passenger',
  code = 'test_' + randomUUID().replaceAll('-', ''),
) {
  const admin = await user('admin');
  const t = await repo.createType(admin, {
    name: pricing.displayName,
    code,
    sector,
    baseFare: null,
    perKmRate: null,
    pricingReference: pricing,
    currency: 'INR',
    active: true,
  });
  ownedTypes.push(t.id);
  return { t, admin };
}
live('persisted demand pricing and transactional booking', () => {
  afterEach(async () => {
    await pool.query('DELETE FROM rides WHERE customer_id=ANY($1::uuid[])', [ownedUsers]);
    await pool.query('DELETE FROM vehicle_types WHERE id=ANY($1::uuid[])', [ownedTypes.splice(0)]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ownedUsers.splice(0)]);
  });
  it('preserves saved demand settings for older Admin clients and rejects silent scalar conversion', async () => {
    const { t, admin } = await type();
    const changed = await repo.updateType(admin, t.id, {
      expectedVersion: 1,
      pricingReference: {
        displayName: pricing.displayName,
        baseFare: pricing.baseFare,
        perKmRate: { minimum: 600, maximum: 800 },
      },
    });
    expect(changed.pricingReference).toMatchObject({
      demandPricing: settings,
      perKmRate: { minimum: 600, maximum: 800 },
    });
    await expect(
      repo.updateType(admin, t.id, {
        expectedVersion: 2,
        baseFare: 15,
        perKmRate: 5,
        pricingReference: null,
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_TYPE_INVALID' });
    expect((await repo.getType(t.id))?.version).toBe(2);
  });
  it('reads saved ranges and Admin audit metadata and rejects concurrent stale updates', async () => {
    const { t, admin } = await type();
    expect((await repo.getType(t.id))?.pricingReference).toEqual(pricing);
    const outcome = await Promise.allSettled([
      repo.updateType(admin, t.id, { name: 'One', expectedVersion: 1 }),
      repo.updateType(admin, t.id, { name: 'Two', expectedVersion: 1 }),
    ]);
    expect(outcome.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcome.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const failed = outcome.find((r) => r.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason.code).toBe(
      'VEHICLE_TYPE_VERSION_CONFLICT',
    );
    const history = await pool.query(
      "SELECT metadata FROM user_history WHERE entity_id=$1 AND event_type='vehicle_type_updated'",
      [t.id],
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].metadata).toMatchObject({ old: { version: 1 }, new: { version: 2 } });
  });
  it('allows distinct saved same-code sector tariffs and never leaks passenger pricing', async () => {
    const { t } = await type();
    const second = await type('rental', t.code);
    expect((await repo.findTypeByCode(t.code, 'rental'))?.id).toBe(second.t.id);
    expect(await repo.findTypeByCode(t.code, 'service')).toBeNull();
    await expect(repo.findTypeByCode(t.code)).rejects.toMatchObject({
      code: 'VEHICLE_TYPE_AMBIGUOUS',
    });
    const e = new FareEstimateService(maps, calc, {}, repo);
    await expect(
      e.estimate(coords, coords, {
        sector: 'service',
        vehicleCategory: t.code,
        pricingMode: 'vehicle_range',
      }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
  });
  it('counts actual submitted bookings in the category window; excludes old and cross-sector rows', async () => {
    const { t } = await type();
    const customer = await user();
    const rides = new PostgresRideRepository(pool);
    const e = new FareEstimateService(maps, calc, {}, repo);
    for (let i = 0; i < 20; i++)
      await rides.create(customer, { ...input, vehicleCategory: t.code, fareEstimate: 25 });
    await rides.create(customer, {
      ...input,
      sector: 'premium',
      vehicleCategory: t.code,
      fareEstimate: 25,
    });
    expect((await repo.measureBookingDemand('passenger', [t.code], 300)).count).toBe(20);
    const high = await e.estimate(coords, coords, {
      sector: 'passenger',
      vehicleCategory: t.code,
      pricingMode: 'vehicle_range',
    });
    expect(high).toMatchObject({
      bookingFare: { baseAmount: 2000, distanceAmount: 1600, grossAmount: 3600 },
      demandPricing: { source: 'booking_window', scoreBasisPoints: 10000, bookingCount: 20 },
    });
    await pool.query(
      "UPDATE rides SET created_at=NOW()-interval '10 minutes' WHERE customer_id=$1",
      [customer],
    );
    const low = await e.estimate(coords, coords, {
      sector: 'passenger',
      vehicleCategory: t.code,
      pricingMode: 'vehicle_range',
    });
    expect(low).toMatchObject({
      bookingFare: { baseAmount: 1500, distanceAmount: 1000, grossAmount: 2500 },
      demandPricing: { scoreBasisPoints: 0, bookingCount: 0 },
    });
  });
  it('locks matching version, rejects repricing races and persists unchanged dynamic snapshots', async () => {
    const { t, admin } = await type();
    const customer = await user();
    const rides = new PostgresRideRepository(pool);
    const e = new FareEstimateService(maps, calc, {}, repo);
    const estimate = await e.estimate(coords, coords, {
      sector: 'passenger',
      vehicleCategory: t.code,
      pricingMode: 'vehicle_range',
    });
    if (!('bookingFare' in estimate) || !estimate.bookingFare) throw Error('No quote');
    const saved = await rides.create(customer, {
      ...input,
      vehicleCategory: t.code,
      bookingFareSnapshot: estimate.bookingFare,
      fareEstimate: 25,
    });
    const snapshot = await pool.query('SELECT route_metadata FROM rides WHERE id=$1', [saved.id]);
    expect(snapshot.rows[0].route_metadata.bookingFareSnapshot).toMatchObject({
      vehicleConfiguration: { id: t.id, version: 1 },
      demandPricing: { source: 'booking_window' },
    });
    await repo.updateType(admin, t.id, {
      expectedVersion: 1,
      pricingReference: { ...pricing, perKmRate: { minimum: 600, maximum: 800 } },
    });
    await expect(
      rides.create(customer, {
        ...input,
        vehicleCategory: t.code,
        bookingFareSnapshot: estimate.bookingFare,
        fareEstimate: 25,
      }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_CHANGED' });
    expect(
      (await pool.query('SELECT id FROM rides WHERE customer_id=$1', [customer])).rows,
    ).toHaveLength(1);
  });
  it('parallel estimates see complete saved settings and use fallback on query failure', async () => {
    const { t } = await type();
    const e = new FareEstimateService(maps, calc, {}, repo);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        e.estimate(coords, coords, {
          sector: 'passenger',
          vehicleCategory: t.code,
          pricingMode: 'vehicle_range',
        }),
      ),
    );
    expect(results.every((r) => 'bookingFare' in r && r.bookingFare?.grossAmount === 2500)).toBe(
      true,
    );
    const failed = Object.create(repo) as PostgresVehicleRepository;
    failed.measureBookingDemand = async () => {
      throw Error('Offline measurement');
    };
    expect(
      await new FareEstimateService(maps, calc, {}, failed).estimate(coords, coords, {
        sector: 'passenger',
        vehicleCategory: t.code,
        pricingMode: 'vehicle_range',
      }),
    ).toMatchObject({
      bookingFare: { grossAmount: 2500 },
      demandPricing: { source: 'minimum_fallback' },
    });
  });
  it('keeps 3-Wheeler base fixed and Tata 407 base maximum unspecified in persisted JSON validation', () => {
    expect(
      vehiclePricingReferenceSchema.safeParse({
        ...pricing,
        baseFare: { minimum: 77500, maximum: null },
      }).success,
    ).toBe(true);
    expect(
      demandProvenance(settings, { count: 20, measuredAt: new Date().toISOString() })
        .scoreBasisPoints,
    ).toBe(10000);
  });
});
