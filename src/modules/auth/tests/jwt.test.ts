import { describe, expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../utils/jwt.js';

describe('JWT utilities', () => {
  it('creates and verifies an access token', async () => {
    const userId = '00000000-0000-0000-0000-000000000001';

    const token = await signAccessToken({
      sub: userId,
      role: 'customer',
      type: 'access',
    });

    const payload = await verifyAccessToken(token);

    expect(payload).toEqual({
      sub: userId,
      role: 'customer',
      type: 'access',
    });
  });

  it('rejects a malformed token', async () => {
    await expect(verifyAccessToken('invalid-token')).rejects.toThrow();
  });

  it('rejects a token with an invalid signature', async () => {
    const token = await signAccessToken({
      sub: '00000000-0000-0000-0000-000000000001',
      role: 'customer',
      type: 'access',
    });

    const tamperedToken = `${token}tampered`;

    await expect(verifyAccessToken(tamperedToken)).rejects.toThrow();
  });
});
