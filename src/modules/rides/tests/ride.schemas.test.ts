import { describe, expect, it } from 'vitest';
import { createRideSchema, fareEstimateSchema, listRidesSchema } from '../schemas/ride.schemas.js';

const validRide = {
  pickup: { latitude: 12.9716, longitude: 77.5946 },
  destination: { latitude: 12.9352, longitude: 77.6245 },
};

describe('ride schemas', () => {
  it('accepts valid coordinates and defaults pagination', () => {
    expect(createRideSchema.parse(validRide)).toEqual(validRide);
    expect(listRidesSchema.parse({})).toMatchObject({ limit: 20 });
  });

  it('accepts a valid fare estimate request', () => {
    expect(fareEstimateSchema.parse(validRide)).toEqual(validRide);
  });

  it('rejects invalid coordinates and unexpected fields', () => {
    expect(() =>
      createRideSchema.parse({
        ...validRide,
        pickup: { latitude: 91, longitude: 77.5 },
      }),
    ).toThrow();

    expect(() =>
      createRideSchema.parse({
        ...validRide,
        status: 'completed',
      }),
    ).toThrow();

    expect(() =>
      listRidesSchema.parse({
        limit: 101,
      }),
    ).toThrow();

    expect(() =>
      fareEstimateSchema.parse({
        ...validRide,
        pickup: {
          latitude: 91,
          longitude: 77.5,
        },
      }),
    ).toThrow();
  });

  it('rejects unexpected fields from fare estimate requests', () => {
    expect(() =>
      fareEstimateSchema.parse({
        ...validRide,
        currency: 'INR',
      }),
    ).toThrow();

    expect(() =>
      fareEstimateSchema.parse({
        ...validRide,
        pickupAddress: 'Jaipur',
      }),
    ).toThrow();
  });

  it('rejects missing pickup or destination', () => {
    expect(() =>
      fareEstimateSchema.parse({
        destination: validRide.destination,
      }),
    ).toThrow();

    expect(() =>
      fareEstimateSchema.parse({
        pickup: validRide.pickup,
      }),
    ).toThrow();
  });
});
