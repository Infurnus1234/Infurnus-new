import { generateKeyPairSync } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleIdentityProvider } from '../providers/google-identity.provider.js';
import { GoogleAuthService } from '../services/google-auth.service.js';

import { googleTokenFixture } from './google-token.fixture.js';

describe('Google official-library verification', () => {
  let fixture: ReturnType<typeof googleTokenFixture>;
  beforeAll(() => {
    fixture = googleTokenFixture();
  });
  it('accepts a cryptographically valid fixture with stable subject', async () => {
    expect(await fixture.provider.verify(await fixture.token())).toMatchObject({
      subject: 'fixture-subject',
      email: 'google-fixture@example.com',
    });
  });
  it.each([
    ['issuer', { iss: 'https://evil.example' }],
    ['audience', { aud: 'wrong-client' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 600 }],
    ['expired within library skew', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['missing subject', { sub: undefined }],
    ['empty subject', { sub: '' }],
    ['missing email', { email: undefined }],
    ['unverified email', { email_verified: false }],
    ['missing expiry', { exp: undefined }],
    ['missing issued-at', { iat: undefined }],
    ['future issued-at', { iat: Math.floor(Date.now() / 1000) + 900 }],
  ])('rejects %s', async (_name, claims) => {
    await expect(fixture.provider.verify(await fixture.token(claims))).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
      statusCode: 401,
    });
  });
  it('rejects malformed tokens without reflecting token contents', async () => {
    await expect(fixture.provider.verify('sensitive-invalid-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
      message: 'Invalid or expired Google ID token',
    });
  });
  it('rejects invalid signatures', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(
      fixture.provider.verify(await fixture.token({}, other.privateKey)),
    ).rejects.toMatchObject({ code: 'INVALID_GOOGLE_TOKEN' });
  });
  it('fails closed when no audience configured', async () => {
    await expect(
      new GoogleIdentityProvider(fixture.client, []).verify(await fixture.token()),
    ).rejects.toMatchObject({ code: 'GOOGLE_AUTH_NOT_CONFIGURED', statusCode: 503 });
  });
  it('sanitizes provider/network failures as unavailable', async () => {
    const client = new OAuth2Client();
    vi.spyOn(client, 'getFederatedSignonCertsAsync').mockRejectedValue(
      new Error('network internals'),
    );
    await expect(
      new GoogleIdentityProvider(client, ['fixture-client']).verify(await fixture.token()),
    ).rejects.toMatchObject({ code: 'GOOGLE_AUTH_UNAVAILABLE', statusCode: 503 });
  });
  it('does not resolve accounts if verification fails', async () => {
    const resolve = vi.fn();
    const service = new GoogleAuthService(
      { verify: vi.fn().mockRejectedValue(new Error('invalid')) },
      { resolve },
    );
    await expect(service.authenticate('invalid')).rejects.toThrow('invalid');
    expect(resolve).not.toHaveBeenCalled();
  });
});
