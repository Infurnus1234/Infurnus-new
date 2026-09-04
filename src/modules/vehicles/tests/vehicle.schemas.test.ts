import { describe, expect, it } from 'vitest';
import { createVehicleSchema, updateVehicleSchema } from '../schemas/vehicle.schemas.js';

const driverProfileId = '750e8400-e29b-41d4-a716-446655440000';

describe('vehicle schemas', () => {
  it('accepts a valid vehicle create payload', () => {
    expect(
      createVehicleSchema.parse({
        driverProfileId,
        make: 'Toyota',
        model: 'Innova',
        color: 'White',
        plateNumber: 'KA01AB1234',
      }),
    ).toMatchObject({ driverProfileId, make: 'Toyota' });
  });

  it('rejects internal fields and invalid values', () => {
    expect(() =>
      createVehicleSchema.parse({
        driverProfileId,
        make: 'Toyota',
        model: 'Innova',
        plateNumber: 'KA01AB1234',
        isActive: false,
      }),
    ).toThrow();
    expect(() =>
      createVehicleSchema.parse({
        driverProfileId: 'bad',
        make: 'Toyota',
        model: 'Innova',
        plateNumber: 'KA01AB1234',
      }),
    ).toThrow();
    expect(() => updateVehicleSchema.parse({})).toThrow();
  });
});
