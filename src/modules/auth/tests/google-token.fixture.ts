import { generateKeyPairSync } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { SignJWT } from 'jose';
import { vi } from 'vitest';
import { GoogleIdentityProvider } from '../providers/google-identity.provider.js';

export function googleTokenFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const client = new OAuth2Client();
  vi.spyOn(client, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { fixture: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    format: 'PEM' as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>['format'],
  });
  const provider = new GoogleIdentityProvider(client, ['fixture-client']);
  async function token(overrides: Record<string, unknown> = {}, key = privateKey) {
    return new SignJWT({
      iss: 'https://accounts.google.com',
      aud: 'fixture-client',
      sub: 'fixture-subject',
      email: 'google-fixture@example.com',
      email_verified: true,
      given_name: 'Google',
      family_name: 'Fixture',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .sign(key);
  }
  return { provider, client, token };
}
