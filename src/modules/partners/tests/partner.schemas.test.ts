import { describe, expect, it } from 'vitest';
import { createPartnerSchema, updatePartnerSchema } from '../schemas/partner.schemas.js';

const userId = '550e8400-e29b-41d4-a716-446655440000';

describe('partner schemas', () => {
  it('accepts a valid partner profile', () => {
    expect(
      createPartnerSchema.parse({
        userId,
        businessName: 'Ada Transport',
        businessDescription: 'Local transport services',
      }),
    ).toMatchObject({ userId, businessName: 'Ada Transport' });
  });

  it('rejects controlled fields and empty updates', () => {
    expect(() =>
      createPartnerSchema.parse({ userId, businessName: 'Ada', approvalStatus: 'approved' }),
    ).toThrow();
    expect(() => updatePartnerSchema.parse({})).toThrow();
  });

  it('validates partner status values', () => {
    expect(() => updatePartnerSchema.parse({ availabilityStatus: 'busy' })).toThrow();
  });
});
