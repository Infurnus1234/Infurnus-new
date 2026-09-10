import { describe, expect, it } from 'vitest';
import {
  createRentalSchema,
  listRentalsSchema,
  cancelRentalSchema,
} from '../schemas/rental.schemas.js';

const validRental = {
  vehicleId: '11111111-1111-4111-8111-111111111111',
  startAt: '2026-10-01T10:00:00+05:30',
  endAt: '2026-10-03T10:00:00+05:30',
  totalAmount: 2500,
  currency: 'INR',
};

describe('rental schemas', () => {
  it('accepts a valid rental and preserves the input', () => {
    expect(createRentalSchema.parse(validRental)).toEqual(validRental);
  });

  it('rejects invalid rental periods', () => {
    expect(() =>
      createRentalSchema.parse({
        ...validRental,
        endAt: validRental.startAt,
      }),
    ).toThrow();

    expect(() =>
      createRentalSchema.parse({
        ...validRental,
        endAt: '2026-09-30T10:00:00+05:30',
      }),
    ).toThrow();
  });

  it('rejects unexpected client fields', () => {
    expect(() =>
      createRentalSchema.parse({
        ...validRental,
        status: 'ACTIVE',
      }),
    ).toThrow();

    expect(() =>
      createRentalSchema.parse({
        ...validRental,
        userId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toThrow();
  });

  it('rejects invalid vehicle IDs and currencies', () => {
    expect(() =>
      createRentalSchema.parse({
        ...validRental,
        vehicleId: 'not-a-uuid',
      }),
    ).toThrow();

    expect(() =>
      createRentalSchema.parse({
        ...validRental,
        currency: 'inr',
      }),
    ).toThrow();
  });

  it('validates cancellation input strictly', () => {
    expect(cancelRentalSchema.parse({ reason: 'Customer changed plans' })).toEqual({
      reason: 'Customer changed plans',
    });

    expect(() =>
      cancelRentalSchema.parse({
        reason: 'Customer changed plans',
        status: 'CANCELLED',
      }),
    ).toThrow();

    expect(() => cancelRentalSchema.parse({ reason: '   ' })).toThrow();
  });

  it('defaults rental list pagination', () => {
    expect(listRentalsSchema.parse({})).toMatchObject({
      limit: 20,
    });
  });

  it('rejects invalid list filters', () => {
    expect(() =>
      listRentalsSchema.parse({
        limit: 101,
      }),
    ).toThrow();

    expect(() =>
      listRentalsSchema.parse({
        vehicleId: 'not-a-uuid',
      }),
    ).toThrow();

    expect(() =>
      listRentalsSchema.parse({
        status: 'UNKNOWN',
      }),
    ).toThrow();
  });
});
