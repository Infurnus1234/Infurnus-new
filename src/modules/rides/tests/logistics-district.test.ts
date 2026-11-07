import { describe, it, expect, vi } from 'vitest';
import { BIHAR_DISTRICTS, districtFromGoogle } from '../../maps/administrative-district.js';
import { GoogleMapsProvider } from '../providers/google.maps.provider.js';
import { CommonMapService } from '../../maps/map.service.js';
import { mapConfig } from '../../maps/map.config.js';
import { LogisticsDestinationResolver } from '../services/logistics-destination.js';
import { sanitizeRideForDriver } from '../utils/ride-sanitizer.js';
import { driverDestinationMarkerAllowed, rideInformation } from '../utils/ride-map-mapper.js';
import type { Ride } from '../types/ride.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { MapProvider } from '../providers/map.provider.js';
const component = (name: string, type: string, short = name) => ({
  long_name: name,
  short_name: short,
  types: [type, 'political'],
});
const result = (name: string, level = 3, state = 'Bihar', country = 'IN') => ({
  formatted_address: 'Private street in a DIFFERENT city',
  geometry: { location: { lat: 26.122, lng: 85.39 } },
  address_components: [
    component('Other city', 'locality'),
    component(name, `administrative_area_level_${level}`),
    component(state, 'administrative_area_level_1'),
    component(country, 'country'),
  ],
});
const district = {
  name: 'Muzaffarpur',
  countryCode: 'IN',
  state: 'Bihar',
  level: 3 as const,
  source: 'google_geocoding' as const,
};
function ride(sector = 'logistics'): Ride {
  return {
    id: 'ride',
    customerId: 'customer',
    assignedDriverId: 'driver',
    assignedVehicleId: 'vehicle',
    sector,
    status: 'driver_arrived',
    pinVerified: false,
    pickup: { latitude: 25.612, longitude: 85.144 },
    pickupAddress: 'Gandhi Maidan, Patna',
    destination: { latitude: 26.122, longitude: 85.39 },
    destinationAddress: 'SECRET exact building Muzaffarpur',
    destinationDistrict: 'Muzaffarpur',
    fareEstimate: 1500,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Ride;
}
describe('typed administrative district detection', () => {
  it.each(BIHAR_DISTRICTS)('supports %s independently of locality/address labels', (name) => {
    expect(districtFromGoogle([result(name)])?.name).toBe(name);
  });
  it.each([
    ['Purbi Champaran', 'East Champaran'],
    ['Pashchim Champaran', 'West Champaran'],
    ['Purnea', 'Purnia'],
    ['Kaimur (Bhabua)', 'Kaimur'],
  ])('normalizes %s', (name, expected) => {
    expect(districtFromGoogle([result(name)])?.name).toBe(expected);
  });
  it('uses district level 3 rather than the division at level 2 in India', () => {
    expect(
      districtFromGoogle([
        result('Bengaluru', 2, 'Karnataka'),
        result('Bengaluru Urban', 3, 'Karnataka'),
      ])?.name,
    ).toBe('Bengaluru Urban');
  });
  it('supports administrative equivalents outside India without imposing Bihar coverage', () => {
    expect(districtFromGoogle([result('Santa Clara County', 2, 'California', 'US')])?.name).toBe(
      'Santa Clara County',
    );
  });
  it('never guesses from city, formatted address, absent country or conflicting results', () => {
    expect(
      districtFromGoogle([
        { address_components: [component('Patna', 'locality')], formatted_address: 'Patna' },
      ]),
    ).toBeNull();
    expect(districtFromGoogle([result('Unknown Bihar district')])).toBeNull();
    expect(districtFromGoogle([result('Patna'), result('Gaya')])).toBeNull();
    expect(districtFromGoogle([])).toBeNull();
  });
  it('sends the selected exact coordinates and requests administrative results', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          json: async () => ({ status: 'OK', results: [result('Muzaffarpur')] }),
        }) as Response,
    );
    const p = new GoogleMapsProvider('non-secret-fixture', fetcher);
    expect(await p.resolveDistrict({ latitude: 26.1220001, longitude: 85.3900001 })).toEqual(
      district,
    );
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get('latlng')).toBe('26.1220001,85.3900001');
    expect(url.searchParams.get('result_type')).toContain('administrative_area_level_3');
  });
  it('does not round nearby boundary coordinates into one cached district lookup', async () => {
    const resolveDistrict = vi.fn(async (point: { latitude: number; longitude: number }) => ({
      ...district,
      name: point.longitude < 85.39000015 ? 'Patna' : 'Nalanda',
    }));
    const service = new CommonMapService(
      { providerName: 'fixture', resolveDistrict } as unknown as MapProvider,
      undefined,
      { ...mapConfig, reversePrecision: 2 },
      Date.now,
      () => {},
    );
    expect((await service.resolveDistrict({ latitude: 25.5, longitude: 85.3900001 }))?.name).toBe(
      'Patna',
    );
    expect((await service.resolveDistrict({ latitude: 25.5, longitude: 85.3900002 }))?.name).toBe(
      'Nalanda',
    );
    expect(resolveDistrict).toHaveBeenCalledTimes(2);
  });
});
describe('Logistics district serialization and lookup', () => {
  it.each(['searching', 'driver_assigned', 'driver_arriving', 'driver_arrived', 'cancelled'])(
    'conceals every precise destination before PIN at %s',
    (status) => {
      const r = {
        ...ride(),
        status,
        destinationDistrictLookup: {
          name: 'Muzaffarpur',
          latitude: 26.122,
          longitude: 85.39,
          resolvedAt: new Date().toISOString(),
          source: 'google_geocoding',
        },
        destinationPlaceId: 'SECRET-place',
        destinationLatitude: 26.122,
        routeMetadata: { destination: { latitude: 26.122, longitude: 85.39 } },
      } as unknown as Ride;
      const dto = sanitizeRideForDriver(r);
      expect(dto.destination).toBeNull();
      expect(dto.destinationAddress).toBe('Muzaffarpur');
      expect(dto.rideInformation.drop).toEqual({ address: 'Muzaffarpur' });
      expect(dto.rideInformation.fare.amount).toBe(1500);
      expect(driverDestinationMarkerAllowed(r)).toBe(false);
      const json = JSON.stringify(dto);
      for (const secret of [
        'SECRET',
        '26.122',
        '85.39',
        'destinationDistrictLookup',
        'routeMetadata',
      ])
        expect(json).not.toContain(secret);
    },
  );
  it('discloses full address/coordinates only after successful PIN and retains completed history', () => {
    for (const status of ['in_progress', 'completed', 'cancelled']) {
      const r = { ...ride(), status, pinVerified: true } as Ride;
      expect(sanitizeRideForDriver(r)).toMatchObject({
        destination: r.destination,
        destinationAddress: r.destinationAddress,
        destinationVisibility: 'full',
      });
    }
  });
  it('fails closed for an unresolved district without hiding price/pickup', () => {
    const r = { ...ride(), destinationDistrict: null };
    expect(sanitizeRideForDriver(r)).toMatchObject({
      pickupAddress: r.pickupAddress,
      destination: null,
      destinationAddress: null,
      rideInformation: { fare: { amount: 1500 }, drop: { address: null } },
    });
  });
  it.each(['passenger', 'rental', 'premium', 'service'])(
    'preserves %s visibility/contract',
    (sector) => {
      const r = ride(sector);
      delete r.destinationDistrict;
      const dto = sanitizeRideForDriver(r);
      expect(dto.destination).toEqual(r.destination);
      expect(dto.destinationAddress).toBeNull();
      expect(dto.rideInformation.drop).toBeNull();
      expect(dto).not.toHaveProperty('destinationDistrict');
      expect(dto).not.toHaveProperty('destinationVisibility');
      expect(rideInformation(r, true).drop).toEqual({
        ...r.destination,
        address: r.destinationAddress,
      });
    },
  );
  it('backfills an old ride with its actual destination coordinates and preserves the original', async () => {
    const r = ride();
    delete r.destinationDistrict;
    const before = JSON.stringify(r.destination);
    const saveDestinationDistrict = vi.fn<NonNullable<RideRepository['saveDestinationDistrict']>>(
        async () => true,
      ),
      resolveDistrict = vi.fn(async () => district);
    await new LogisticsDestinationResolver(
      { saveDestinationDistrict } as unknown as RideRepository,
      { resolveDistrict },
    ).prepare(r);
    expect(r.destinationDistrict).toBe('Muzaffarpur');
    expect(JSON.stringify(r.destination)).toBe(before);
    expect(r.destinationAddress).toContain('SECRET');
    expect(resolveDistrict).toHaveBeenCalledWith(r.destination, { source: 'LOGISTICS' });
    expect(saveDestinationDistrict.mock.calls[0]?.[2]).toMatchObject({ name: 'Muzaffarpur' });
    await new LogisticsDestinationResolver({} as RideRepository, { resolveDistrict }).prepare(r);
    expect(resolveDistrict).toHaveBeenCalledTimes(1);
  });
  it('provider failures do not expose destination or stop booking; other sectors do not geocode', async () => {
    const resolveDistrict = vi.fn(async () => {
      throw Error('private provider details');
    });
    const r = ride();
    delete r.destinationDistrict;
    const resolver = new LogisticsDestinationResolver(
      { saveDestinationDistrict: async () => true } as unknown as RideRepository,
      { resolveDistrict },
    );
    await expect(resolver.prepare(r)).resolves.toMatchObject({ destinationDistrict: null });
    for (const sector of ['passenger', 'rental', 'premium', 'service'])
      await resolver.prepare(ride(sector));
    expect(resolveDistrict).toHaveBeenCalledTimes(1);
  });
});
