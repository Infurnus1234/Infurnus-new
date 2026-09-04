import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from '../utils/refresh-token.js';

describe('refresh token utilities', () => {
  it('generates a cryptographically random refresh token', () => {
    const token = generateRefreshToken();

    expect(token).toBeTypeOf('string');
    expect(token.length).toBeGreaterThan(40);
  });

  it('generates unique refresh tokens', () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();

    expect(first).not.toBe(second);
  });

  it('hashes a refresh token deterministically', () => {
    const token = generateRefreshToken();

    const firstHash = hashRefreshToken(token);
    const secondHash = hashRefreshToken(token);

    expect(firstHash).toBe(secondHash);
  });

  it('does not store the refresh token itself in the hash', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
