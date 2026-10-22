import { describe, it, expect } from 'vitest';
import { envSchema } from '../../config/env.js';
const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
  JWT_ACCESS_SECRET: 'fixture-secret-that-is-longer-than-32-characters',
  AUTH_OTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};
describe('Firebase deployment environment', () => {
  it('accepts Cloud Run application-default credentials with an explicit project', () => {
    expect(envSchema.safeParse({ ...base, FIREBASE_PROJECT_ID: 'fixture-project' }).success).toBe(
      true,
    );
  });
  it.each([
    { FIREBASE_CLIENT_EMAIL: 'fixture@example.com' },
    { FIREBASE_PRIVATE_KEY: 'fixture-key' },
    { FIREBASE_PROJECT_ID: 'fixture-project', FIREBASE_CLIENT_EMAIL: 'fixture@example.com' },
    { FIREBASE_PROJECT_ID: 'fixture-project', FIREBASE_PRIVATE_KEY: 'fixture-key' },
  ])('rejects incomplete explicit credentials', (credentials) => {
    expect(envSchema.safeParse({ ...base, ...credentials }).success).toBe(false);
  });
});
