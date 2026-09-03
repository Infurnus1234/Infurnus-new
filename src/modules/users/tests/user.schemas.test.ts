import { describe, expect, it } from 'vitest';
import { createUserSchema, updateUserSchema } from '../schemas/user.schemas.js';

const validUser = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'Ada@example.com',
  phone: '+14155552671',
};

describe('user schemas', () => {
  it('accepts a valid create payload and normalizes email', () => {
    expect(createUserSchema.parse(validUser)).toEqual({ ...validUser, email: 'ada@example.com' });
  });

  it('rejects missing required fields', () => {
    expect(() => createUserSchema.parse({ firstName: 'Ada' })).toThrow();
  });

  it('rejects invalid types and field values', () => {
    expect(() => createUserSchema.parse({ ...validUser, firstName: 12 })).toThrow();
    expect(() => createUserSchema.parse({ ...validUser, email: 'invalid' })).toThrow();
    expect(() => createUserSchema.parse({ ...validUser, phone: '123' })).toThrow();
  });

  it('rejects unexpected and internally controlled fields', () => {
    expect(() => createUserSchema.parse({ ...validUser, id: 'internal-id' })).toThrow();
    expect(() => updateUserSchema.parse({ passwordHash: 'secret' })).toThrow();
  });

  it('accepts a partial profile update but rejects an empty update', () => {
    expect(updateUserSchema.parse({ firstName: 'Grace' })).toEqual({ firstName: 'Grace' });
    expect(() => updateUserSchema.parse({})).toThrow();
  });
});
