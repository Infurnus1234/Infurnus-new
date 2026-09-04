import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../utils/password.js';

describe('password utilities', () => {
  it('hashes a password without returning the plaintext', async () => {
    const password = 'StrongPassword123!';

    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(0);
  });

  it('verifies the correct password', async () => {
    const password = 'StrongPassword123!';

    const hash = await hashPassword(password);

    await expect(verifyPassword(hash, password)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('StrongPassword123!');

    await expect(verifyPassword(hash, 'WrongPassword123!')).resolves.toBe(false);
  });

  it('produces different hashes for the same password', async () => {
    const password = 'StrongPassword123!';

    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    expect(firstHash).not.toBe(secondHash);
  });
});
