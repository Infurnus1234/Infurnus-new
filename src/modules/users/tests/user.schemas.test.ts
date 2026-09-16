import { describe, expect, it } from 'vitest';

import {
  createAddressSchema,
  createUserSchema,
  updateAddressSchema,
  updatePreferencesSchema,
  updateUserSchema,
  userAddressParamsSchema,
  userHistoryQuerySchema,
  userIdSchema,
} from '../schemas/user.schemas.js';

describe('User schemas', () => {
  // ==========================================================
  // createUserSchema
  // ==========================================================

  describe('createUserSchema', () => {
    it('accepts a valid user', () => {
      const result = createUserSchema.safeParse({
        firstName: 'Niranjan',
        lastName: 'Kumar',
        email: 'USER@Example.COM',
        phone: '+919876543210',
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.email).toBe('user@example.com');
      }
    });

    it('trims names and email', () => {
      const result = createUserSchema.safeParse({
        firstName: '  Niranjan  ',
        lastName: '  Kumar  ',
        email: '  USER@Example.COM  ',
        phone: ' +919876543210 ',
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.firstName).toBe('Niranjan');
        expect(result.data.lastName).toBe('Kumar');
        expect(result.data.email).toBe('user@example.com');
        expect(result.data.phone).toBe('+919876543210');
      }
    });

    it('rejects missing required fields', () => {
      const result = createUserSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('rejects an invalid email', () => {
      const result = createUserSchema.safeParse({
        firstName: 'Niranjan',
        lastName: 'Kumar',
        email: 'invalid-email',
        phone: '+919876543210',
      });

      expect(result.success).toBe(false);
    });

    it('rejects an invalid phone number', () => {
      const result = createUserSchema.safeParse({
        firstName: 'Niranjan',
        lastName: 'Kumar',
        email: 'user@example.com',
        phone: '123',
      });

      expect(result.success).toBe(false);
    });

    it('rejects unknown fields', () => {
      const result = createUserSchema.safeParse({
        firstName: 'Niranjan',
        lastName: 'Kumar',
        email: 'user@example.com',
        phone: '+919876543210',
        role: 'admin',
      });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================
  // updateUserSchema
  // ==========================================================

  describe('updateUserSchema', () => {
    it('accepts a first-name update', () => {
      const result = updateUserSchema.safeParse({
        firstName: 'Rahul',
      });

      expect(result.success).toBe(true);
    });

    it('accepts a last-name update', () => {
      const result = updateUserSchema.safeParse({
        lastName: 'Sharma',
      });

      expect(result.success).toBe(true);
    });

    it('accepts an email update and normalizes it', () => {
      const result = updateUserSchema.safeParse({
        email: '  USER@Example.COM ',
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.email).toBe('user@example.com');
      }
    });

    it('accepts a phone update', () => {
      const result = updateUserSchema.safeParse({
        phone: '+919876543210',
      });

      expect(result.success).toBe(true);
    });

    it('accepts multiple fields', () => {
      const result = updateUserSchema.safeParse({
        firstName: 'Niranjan',
        lastName: 'Kumar',
      });

      expect(result.success).toBe(true);
    });

    it('rejects an empty update', () => {
      const result = updateUserSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('rejects unknown fields', () => {
      const result = updateUserSchema.safeParse({
        username: 'niranjan',
      });

      expect(result.success).toBe(false);
    });

    it('rejects an invalid phone number', () => {
      const result = updateUserSchema.safeParse({
        phone: '123',
      });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================
  // userIdSchema
  // ==========================================================

  describe('userIdSchema', () => {
    it('accepts a valid UUID', () => {
      const result = userIdSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(true);
    });

    it('rejects an invalid UUID', () => {
      const result = userIdSchema.safeParse({
        id: 'not-a-uuid',
      });

      expect(result.success).toBe(false);
    });

    it('rejects unknown fields', () => {
      const result = userIdSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        extra: true,
      });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================
  // userAddressParamsSchema
  // ==========================================================

  describe('userAddressParamsSchema', () => {
    it('accepts valid user and address UUIDs', () => {
      const result = userAddressParamsSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        addressId: '650e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(true);
    });

    it('rejects an invalid address UUID', () => {
      const result = userAddressParamsSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        addressId: 'invalid',
      });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================
  // userHistoryQuerySchema
  // ==========================================================

  describe('userHistoryQuerySchema', () => {
    it('accepts a valid limit', () => {
      const result = userHistoryQuerySchema.safeParse({
        limit: '25',
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.limit).toBe(25);
      }
    });

    it('coerces the limit to a number', () => {
      const result = userHistoryQuerySchema.safeParse({
        limit: 10,
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.limit).toBe(10);
      }
    });

    it('uses the default limit when omitted', () => {
      const result = userHistoryQuerySchema.safeParse({});

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.limit).toBe(50);
      }
    });

    it('rejects a limit below 1', () => {
      const result = userHistoryQuerySchema.safeParse({
        limit: 0,
      });

      expect(result.success).toBe(false);
    });

    it('rejects a limit above 100', () => {
      const result = userHistoryQuerySchema.safeParse({
        limit: 101,
      });

      expect(result.success).toBe(false);
    });

    it('rejects a non-integer limit', () => {
      const result = userHistoryQuerySchema.safeParse({
        limit: 10.5,
      });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================
  // createAddressSchema
  // ==========================================================

  describe('createAddressSchema', () => {
    const validAddress = {
      label: 'Home',
      addressLine1: '123 Main Street',
      city: 'Jaipur',
      state: 'Rajasthan',
      postalCode: '302001',
    };

    it('accepts a valid address', () => {
      const result = createAddressSchema.safeParse(validAddress);

      expect(result.success).toBe(true);
    });

    it('accepts an address with optional fields', () => {
      const result = createAddressSchema.safeParse({
        ...validAddress,
        addressLine2: 'Near Central Park',
        country: 'India',
        latitude: 26.9124,
        longitude: 75.7873,
        isDefault: true,
      });

      expect(result.success).toBe(true);
    });

    it('requires latitude and longitude together', () => {
      const result = createAddressSchema.safeParse({
        ...validAddress,
        latitude: 26.9124,
      });

      expect(result.success).toBe(false);
    });

    it('requires longitude when latitude is provided', () => {
      const result = createAddressSchema.safeParse({
        ...validAddress,
        longitude: 75.7873,
      });

      expect(result.success).toBe(false);
    });

    it('accepts valid latitude and longitude boundaries', () => {
      const result = createAddressSchema.safeParse({
        ...validAddress,
        latitude: 90,
        longitude: 180,
      });

      expect(result.success).toBe(true);
    });

    it('rejects latitude outside the valid range', () => {
      const result = createAddressSchema.safeParse({
        ...validAddress,
        latitude: 91,
        longitude: 75,
      });

      expect(result.success).toBe(false);
    });

    it('rejects longitude outside the valid range', () => {
      const result = createAddressSchema.safeParse({
        ...validAddress,
        latitude: 26,
        longitude: 181,
      });

      expect(result.success).toBe(false);
    });

    it('rejects unknown fields', () => {
      const result = createAddressSchema.safeParse({
        ...validAddress,
        unknownField: true,
      });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================
  // updateAddressSchema
  // ==========================================================

  describe('updateAddressSchema', () => {
    it('accepts a partial address update', () => {
      const result = updateAddressSchema.safeParse({
        city: 'Delhi',
      });

      expect(result.success).toBe(true);
    });

    it('rejects an empty update', () => {
      const result = updateAddressSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('requires latitude and longitude together', () => {
      const result = updateAddressSchema.safeParse({
        latitude: 26.9124,
      });

      expect(result.success).toBe(false);
    });

    it('accepts latitude and longitude together', () => {
      const result = updateAddressSchema.safeParse({
        latitude: 26.9124,
        longitude: 75.7873,
      });

      expect(result.success).toBe(true);
    });

    it('rejects unknown fields', () => {
      const result = updateAddressSchema.safeParse({
        city: 'Jaipur',
        unknownField: true,
      });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================================
  // updatePreferencesSchema
  // ==========================================================

  describe('updatePreferencesSchema', () => {
    it('accepts a single preference update', () => {
      const result = updatePreferencesSchema.safeParse({
        pushNotificationsEnabled: false,
      });

      expect(result.success).toBe(true);
    });

    it('accepts multiple preference updates', () => {
      const result = updatePreferencesSchema.safeParse({
        pushNotificationsEnabled: false,
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: false,
      });

      expect(result.success).toBe(true);
    });

    it('rejects an empty update', () => {
      const result = updatePreferencesSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('rejects non-boolean values', () => {
      const result = updatePreferencesSchema.safeParse({
        pushNotificationsEnabled: 'false',
      });

      expect(result.success).toBe(false);
    });

    it('rejects unknown fields', () => {
      const result = updatePreferencesSchema.safeParse({
        pushNotificationsEnabled: true,
        unknownField: true,
      });

      expect(result.success).toBe(false);
    });
  });
});
