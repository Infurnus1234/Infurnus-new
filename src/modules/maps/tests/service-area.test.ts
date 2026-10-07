import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceAreaPolicy, type ServiceAreaGate } from '../service-area.js';
import { CommonMapService } from '../map.service.js';
import { mapConfig } from '../map.config.js';
import { AppError } from '../../../common/errors/app-error.js';
import { MatchingService } from '../../rides/services/matching.service.js';
import { RideService } from '../../rides/services/ride.service.js';
import { RideDispatchService } from '../../rides/services/ride-dispatch.service.js';
import { RouteRecalculationService } from '../../rides/services/route-recalculation.service.js';
import type { DriverRepository } from '../../rides/repositories/driver.repository.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import type { CreateRideInput } from '../../rides/schemas/ride.schemas.js';
import type { Ride } from '../../rides/types/ride.js';

const inside = { latitude: 0.5, longitude: 0.5 };
const outside = { latitude: 2, longitude: 2 };
// Synthetic test coordinates: this is deliberately NOT a Bihar dataset.
const boundary = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};
const provider = () => ({
  providerName: 'google',
  calculateRoute: vi.fn(async () => ({ distanceMeters: 1, durationSeconds: 1 })),
  calculateMatrix: vi.fn(async () => []),
  places: vi.fn(async () => []),
  geocode: vi.fn(async () => null),
});
const denied: ServiceAreaGate = {
  configured: true,
  required: true,
  assertSupported: vi.fn(async () => {
    throw new AppError('SERVICE_AREA_UNAVAILABLE', "We're coming soon to your area.", 422);
  }),
};

describe('central service-area and storage guards', () => {
  it('fails closed when required coverage is not configured', async () => {
    await expect(new ServiceAreaPolicy(undefined).assertSupported([inside])).rejects.toMatchObject({
      code: 'SERVICE_AREA_NOT_CONFIGURED',
      statusCode: 503,
    });
  });
  it('allows explicitly nonrequired local unknown coverage without claiming it is configured', async () => {
    const area = new ServiceAreaPolicy(undefined, false);
    expect(area.configured).toBe(false);
    await area.assertSupported([inside]);
  });
  it('rejects nonpolygon configuration', () => {
    expect(() => new ServiceAreaPolicy({ type: 'Point', coordinates: [0, 0] })).toThrow();
  });
  it('blocks routing and matrix provider calls for unsupported operations', async () => {
    const external = provider();
    const maps = new CommonMapService(external, undefined, mapConfig, Date.now, () => {}, denied);
    await expect(maps.calculateRoute(inside, outside)).rejects.toMatchObject({
      code: 'SERVICE_AREA_UNAVAILABLE',
    });
    await expect(maps.calculateMatrix([inside], outside)).rejects.toMatchObject({
      code: 'SERVICE_AREA_UNAVAILABLE',
    });
    expect(external.calculateRoute).not.toHaveBeenCalled();
    expect(external.calculateMatrix).not.toHaveBeenCalled();
  });
  it('blocks discovery before querying availability', async () => {
    const findNearbyEligible = vi.fn();
    const matching = new MatchingService(
      { findNearbyEligible } as unknown as DriverRepository,
      undefined,
      denied,
    );
    await expect(matching.findRankedDrivers(outside)).rejects.toMatchObject({
      code: 'SERVICE_AREA_UNAVAILABLE',
    });
    expect(findNearbyEligible).not.toHaveBeenCalled();
  });
  it('blocks booking before estimation or insertion', async () => {
    const create = vi.fn();
    const rides = new RideService(
      { create } as unknown as RideRepository,
      undefined,
      undefined,
      undefined,
      undefined,
      denied,
    );
    await expect(
      rides.createRide('customer', { pickup: inside, destination: outside } as CreateRideInput),
    ).rejects.toMatchObject({ code: 'SERVICE_AREA_UNAVAILABLE' });
    expect(create).not.toHaveBeenCalled();
  });
  it('blocks dispatch before matching, offering, or notifying', async () => {
    const offerDispatch = vi.fn(),
      findRankedDrivers = vi.fn(),
      notify = vi.fn();
    const dispatcher = new RideDispatchService(
      { offerDispatch } as unknown as RideRepository,
      { findRankedDrivers } as unknown as MatchingService,
      notify,
      100,
      denied,
    );
    await expect(
      dispatcher.dispatch({ id: 'unsupported', pickup: inside, destination: outside } as Ride),
    ).rejects.toMatchObject({ code: 'SERVICE_AREA_UNAVAILABLE' });
    expect(findRankedDrivers).not.toHaveBeenCalled();
    expect(offerDispatch).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    dispatcher.dispose();
  });
  it('does not treat Redis content-cache permission as durable JSONB permission', () => {
    const maps = new CommonMapService(provider(), undefined, {
      ...mapConfig,
      providerContentCaching: true,
    });
    expect(maps.navigationStorageAllowed).toBe(false);
  });
  it('supports transient Google navigation without durable JSONB permission', async () => {
    const external = provider(),
      persist = vi.fn();
    const maps = new CommonMapService(external, undefined, {
      ...mapConfig,
      providerContentCaching: false,
    });
    expect(maps.forSource('RIDE').navigationStorageAllowed).toBe(false);
    await expect(
      new RouteRecalculationService(maps.forSource('RIDE')).process(
        'ride',
        null,
        inside,
        outside,
        'destination',
        persist,
      ),
    ).resolves.toMatchObject({ segment: 'destination', routeVersion: 1 });
    expect(external.calculateRoute).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });
});

(process.env.RIDE_DB_TESTS === 'true' ? describe : describe.skip)(
  'real PostGIS synthetic service-area boundary',
  () => {
    it('supports inside and boundary points and rejects outside', async () => {
      const area = new ServiceAreaPolicy(boundary);
      await area.assertSupported([inside, { latitude: 0, longitude: 0 }]);
      await expect(area.assertSupported([inside, outside])).rejects.toMatchObject({
        code: 'SERVICE_AREA_UNAVAILABLE',
        message: "We're coming soon to your area.",
        statusCode: 422,
      });
    });
    it('rejects points in holes and supports a second multipolygon', async () => {
      const area = new ServiceAreaPolicy({
        type: 'MultiPolygon',
        coordinates: [
          [
            ...boundary.coordinates,
            [
              [0.2, 0.2],
              [0.2, 0.8],
              [0.8, 0.8],
              [0.8, 0.2],
              [0.2, 0.2],
            ],
          ],
          [
            [
              [2, 2],
              [3, 2],
              [3, 3],
              [2, 3],
              [2, 2],
            ],
          ],
        ],
      });
      await area.assertSupported([{ latitude: 2.5, longitude: 2.5 }]);
      await expect(area.assertSupported([inside])).rejects.toMatchObject({
        code: 'SERVICE_AREA_UNAVAILABLE',
      });
    });
    it('fails closed on invalid or empty polygons', async () => {
      await expect(
        new ServiceAreaPolicy({ type: 'Polygon', coordinates: [] }).assertSupported([inside]),
      ).rejects.toMatchObject({ statusCode: 503 });
      await expect(
        new ServiceAreaPolicy({
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 1],
              [1, 0],
              [0, 1],
              [0, 0],
            ],
          ],
        }).assertSupported([inside]),
      ).rejects.toMatchObject({ statusCode: 503 });
    });
  },
);

it('preserves the service-area coming-soon error through fare integration', async () => {
  const maps = new CommonMapService(provider(), undefined, mapConfig, Date.now, () => {}, denied);
  const fares = new FareEstimateService(maps, new FareCalculatorService());
  await expect(fares.estimate(inside, outside)).rejects.toMatchObject({
    code: 'SERVICE_AREA_UNAVAILABLE',
    statusCode: 422,
    message: "We're coming soon to your area.",
  });
});

it('bounds boundary size and point batches without database work', async () => {
  expect(() => new ServiceAreaPolicy({ ...boundary, unexpected: 'x'.repeat(2000000) })).toThrow(
    'supported size',
  );
  await expect(
    new ServiceAreaPolicy(undefined, false).assertSupported(
      Array.from({ length: 101 }, () => inside),
    ),
  ).rejects.toMatchObject({ code: 'MAP_INPUT_INVALID' });
});
(process.env.RIDE_DB_TESTS === 'true' ? it : it.skip)(
  'rejects geometry explicitly marked with a non-WGS84 CRS',
  async () => {
    await expect(
      new ServiceAreaPolicy({
        ...boundary,
        crs: { type: 'name', properties: { name: 'EPSG:3857' } },
      }).assertSupported([inside]),
    ).rejects.toMatchObject({ statusCode: 503 });
  },
);
