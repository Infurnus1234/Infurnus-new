import { describe, expect, it } from 'vitest';
import { createRideSchema, listRidesSchema } from '../schemas/ride.schemas.js';

const validRide = {
  pickup: { latitude: 12.9716, longitude: 77.5946 },
  destination: { latitude: 12.9352, longitude: 77.6245 },
};

describe('ride schemas', () => {
  it('accepts valid coordinates and defaults pagination', () => {
    expect(createRideSchema.parse(validRide)).toEqual(validRide);
    expect(listRidesSchema.parse({})).toMatchObject({ limit: 20 });
  });

  it('rejects invalid coordinates and unexpected fields', () => {
    expect(() =>
      createRideSchema.parse({
        ...validRide,
        pickup: { latitude: 91, longitude: 77.5 },
      }),
    ).toThrow();
    expect(() => createRideSchema.parse({ ...validRide, status: 'completed' })).toThrow();
    expect(() => listRidesSchema.parse({ limit: 101 })).toThrow();
  });
});
