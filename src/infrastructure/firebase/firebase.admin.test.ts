import { generateKeyPairSync } from 'node:crypto';
import { getApps, deleteApp } from 'firebase-admin/app';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('../../config/env.js', () => ({
  env: {
    FIREBASE_PROJECT_ID: undefined,
    FIREBASE_CLIENT_EMAIL: undefined,
    FIREBASE_PRIVATE_KEY: undefined,
  },
}));
import { env } from '../../config/env.js';
beforeEach(async () => {
  vi.resetModules();
  for (const app of getApps()) await deleteApp(app);
  env.FIREBASE_PROJECT_ID = undefined;
  env.FIREBASE_CLIENT_EMAIL = undefined;
  env.FIREBASE_PRIVATE_KEY = undefined;
});
afterEach(async () => {
  for (const app of getApps()) await deleteApp(app);
});
describe('Firebase Admin configuration, without live FCM access', () => {
  it('missing credentials do not create an app or claim messaging readiness', async () => {
    expect((await import('./firebase.admin.js')).getFirebaseMessaging()).toBeNull();
    expect(getApps()).toHaveLength(0);
  });
  it('partial credentials fail closed', async () => {
    env.FIREBASE_PROJECT_ID = 'fixture-project';
    const imported = await import('./firebase.admin.js');
    expect(() => imported.initFirebaseAdmin()).toThrow('FIREBASE_CONFIGURATION_INCOMPLETE');
  });
  it('invalid private keys are rejected without returning private content', async () => {
    env.FIREBASE_PROJECT_ID = 'fixture-project';
    env.FIREBASE_CLIENT_EMAIL = 'fixture@fixture-project.iam.gserviceaccount.com';
    env.FIREBASE_PRIVATE_KEY = 'fixture-private-invalid';
    const imported = await import('./firebase.admin.js');
    expect(() => imported.initFirebaseAdmin()).toThrow(/^FIREBASE_INITIALIZATION_FAILED$/);
    expect(getApps()).toHaveLength(0);
  });
  it('initializes a valid local service-account structure once; this does not validate IAM or send a message', async () => {
    const key = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    env.FIREBASE_PROJECT_ID = 'fixture-project';
    env.FIREBASE_CLIENT_EMAIL = 'fixture@fixture-project.iam.gserviceaccount.com';
    env.FIREBASE_PRIVATE_KEY = key.replace(/\n/g, '\\n');
    const imported = await import('./firebase.admin.js');
    imported.initFirebaseAdmin();
    imported.initFirebaseAdmin();
    expect(getApps()).toHaveLength(1);
    expect(imported.getFirebaseMessaging()).not.toBeNull();
  });
});
