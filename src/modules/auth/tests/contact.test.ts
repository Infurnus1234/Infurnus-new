import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizePhone } from '../utils/contact.js';

describe('contact normalization', () => {
  describe('normalizeEmail', () => {
    it('trims surrounding whitespace', () => {
      expect(normalizeEmail('  User@Example.com  ')).toBe('user@example.com');
    });

    it('lowercases email addresses', () => {
      expect(normalizeEmail('USER@EXAMPLE.COM')).toBe('user@example.com');
    });

    it('trims and lowercases together', () => {
      expect(normalizeEmail('  USER.Name+Test@Example.COM  ')).toBe('user.name+test@example.com');
    });
  });

  describe('normalizePhone', () => {
    it('removes spaces from phone numbers', () => {
      expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    });

    it('removes formatting characters', () => {
      expect(normalizePhone('+91-98765-43210')).toBe('+919876543210');
    });

    it('preserves an already normalized phone number', () => {
      expect(normalizePhone('+919876543210')).toBe('+919876543210');
    });

    it('does not invent a country code', () => {
      expect(normalizePhone('9876543210')).toBe('9876543210');
    });

    it('trims surrounding whitespace', () => {
      expect(normalizePhone('  +91 98765 43210  ')).toBe('+919876543210');
    });
  });
});
