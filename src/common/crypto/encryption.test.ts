import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from './encryption.js';

describe('encryption', () => {
  const secret = 'sendmator-session-token-example';

  it('encrypts and decrypts a secret correctly', () => {
    const encrypted = encryptSecret(secret);

    expect(encrypted).not.toBe(secret);

    const decrypted = decryptSecret(encrypted);

    expect(decrypted).toBe(secret);
  });

  it('produces different ciphertext for the same plaintext', () => {
    const first = encryptSecret(secret);
    const second = encryptSecret(secret);

    expect(first).not.toBe(second);

    expect(decryptSecret(first)).toBe(secret);
    expect(decryptSecret(second)).toBe(secret);
  });

  it('produces the expected versioned ciphertext format', () => {
    const encrypted = encryptSecret(secret);

    const parts = encrypted.split('.');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');

    expect(parts[1]).toBeTruthy();
    expect(parts[2]).toBeTruthy();
    expect(parts[3]).toBeTruthy();
  });

  it('rejects an empty plaintext', () => {
    expect(() => encryptSecret('')).toThrowError('Secret value cannot be empty');
  });

  it('rejects an empty encrypted value', () => {
    expect(() => decryptSecret('')).toThrowError('Encrypted value cannot be empty');
  });

  it('rejects malformed encrypted values', () => {
    expect(() => decryptSecret('invalid')).toThrowError('Invalid encrypted value');
  });

  it('rejects an unsupported encryption version', () => {
    const encrypted = encryptSecret(secret);

    const parts = encrypted.split('.');

    parts[0] = 'v2';

    expect(() => decryptSecret(parts.join('.'))).toThrowError(
      'Unsupported encrypted value version',
    );
  });

  it('rejects an invalid IV', () => {
    const encrypted = encryptSecret(secret);

    const parts = encrypted.split('.');

    parts[1] = Buffer.from('invalid-iv').toString('base64');

    expect(() => decryptSecret(parts.join('.'))).toThrowError('Failed to decrypt secret value');
  });

  it('rejects an invalid authentication tag', () => {
    const encrypted = encryptSecret(secret);

    const parts = encrypted.split('.');

    parts[2] = Buffer.alloc(16, 0).toString('base64');

    expect(() => decryptSecret(parts.join('.'))).toThrowError('Failed to decrypt secret value');
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptSecret(secret);

    const parts = encrypted.split('.');

    const ciphertext = Buffer.from(parts[3]!, 'base64');

    ciphertext[0] = ciphertext[0]! ^ 1;

    parts[3] = ciphertext.toString('base64');

    expect(() => decryptSecret(parts.join('.'))).toThrowError('Failed to decrypt secret value');
  });

  it('rejects empty ciphertext', () => {
    const encrypted = encryptSecret(secret);

    const parts = encrypted.split('.');

    parts[3] = '';

    expect(() => decryptSecret(parts.join('.'))).toThrowError('Failed to decrypt secret value');
  });

  it('does not expose the original secret in the encrypted value', () => {
    const encrypted = encryptSecret(secret);

    expect(encrypted).not.toContain(secret);
  });
});
