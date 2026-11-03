import { describe, expect, it, vi } from 'vitest';
import { RideService } from '../services/ride.service.js';
import { MatchingService } from '../services/matching.service.js';
import type { Ride } from '../types/ride.js';
import type { Coordinates } from '../providers/map.provider.js';

const places = {
  Patna: { latitude: 25.6027, longitude: 85.1376 },
  Muzaffarpur: { latitude: 26.1197, longitude: 85.391 },
  Motihari: { latitude: 26.6469, longitude: 84.9089 },
  Gaya: { latitude: 24.7955, longitude: 84.9994 },
  Delhi: { latitude: 28.6139, longitude: 77.209 },
  Jaipur: { latitude: 26.9124, longitude: 75.7873 },
};
const scenarios = [
  ['Patna', 'Muzaffarpur', 'Gaya'],
  ['Muzaffarpur', 'Patna', 'Gaya'],
  ['Motihari', 'Gaya', 'Patna'],
  ['Delhi', 'Patna', 'Muzaffarpur'],
  ['Jaipur', 'Muzaffarpur', 'Patna'],
] as const;

describe('booking coordinates are independent of customer GPS', () => {
  for (const sector of ['passenger', 'rental', 'logistics', 'premium'] as const) {
    it.each(scenarios)(
      `${sector}: customer in %s books pickup in %s`,
      async (physical, city, drop) => {
        const pickup = places[city],
          destination = places[drop],
          gps = places[physical];
        const area = {
          configured: true,
          required: true,
          assertSupported: vi.fn(async (points: Coordinates[]) => {
            // A remote customer's GPS must never be submitted as a booking endpoint.
            for (const point of points) expect([pickup, destination]).toContainEqual(point);
          }),
        };
        const nearby = vi.fn(async (..._args: unknown[]) => [
          {
            driverProfileId: 'driver',
            userId: 'driver-user',
            vehicleId: 'vehicle',
            latitude: pickup.latitude,
            longitude: pickup.longitude,
            distanceMeters: 300,
          },
        ]);
        const resolve = vi.fn(async () => ({ cityId: 'configured-pickup-city' }));
        const matching = new MatchingService(
          { findNearbyEligible: nearby } as never,
          undefined,
          area,
          { resolve } as never,
        );
        const create = vi.fn(async (_customer: string, input: Record<string, unknown>) => ({
          ...input,
          id: 'ride',
          customerId: 'customer',
          status: 'searching',
        }));
        const updateUserLocation = vi.fn(async () => true);
        const repository = {
          create,
          updateUserLocation,
          getRideMapSnapshot: vi.fn(async () => ({ ride: snapshot })),
        };
        const estimate = vi.fn(async () => ({ grossAmount: 10000, distanceMeters: 1000 }));
        const service = new RideService(
          repository as never,
          undefined,
          undefined,
          { estimate } as never,
          undefined,
          area,
          undefined,
          matching,
        );
        const ride = await service.createRide('customer', {
          pickup,
          destination,
          sector,
          vehicleCategory: sector === 'logistics' ? 'mini_truck' : 'sedan',
          bookingHours: 2,
        });
        expect(create.mock.calls[0]?.[1]).toMatchObject({ pickup, destination, sector });
        expect(nearby.mock.calls[0]?.slice(0, 2)).toEqual([pickup.latitude, pickup.longitude]);
        if (sector === 'premium') expect(resolve).toHaveBeenCalledWith(pickup, true);
        const snapshot = { ...ride, status: 'driver_assigned' } as Ride;
        const result = await service.updateUserLocation('customer', 'ride', {
          ...gps,
          timestamp: new Date(Date.now() - 1000),
        });
        expect(result).toMatchObject(gps);
        expect(updateUserLocation).toHaveBeenCalledWith(
          'ride',
          'customer',
          expect.objectContaining(gps),
        );
        expect(ride.pickup).toEqual(pickup);
        expect(ride.destination).toEqual(destination);
      },
    );
  }
});
