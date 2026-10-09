import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { env } from '../../../config/env.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { GoogleAuthService } from '../services/google-auth.service.js';
import { PostgresGoogleIdentityRepository } from '../repositories/google-identity.repository.js';
import { signAccessToken, verifyAccessToken } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireDriver } from '../middleware/authorization.middleware.js';
import { DriverController } from '../../rides/controllers/driver.controller.js';
import { DriverService } from '../../rides/services/driver.service.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import type { RideService } from '../../rides/services/ride.service.js';
import type { DriverDocumentStorageService } from '../../rides/services/driver-document-storage.service.js';
import { googleTokenFixture } from './google-token.fixture.js';

// Google certificate transport is replaced with a signed fixture; identity validation,
// PostgreSQL transactions, sessions and protected Driver handlers remain real.
describe('Driver Google identity, onboarding and role boundaries', () => {
  const fixture = googleTokenFixture();
  let app: ReturnType<typeof express>;
  let email: string;
  let subject: string;
  let idToken: string;
  beforeEach(async () => {
    subject = 'driver-google-' + randomUUID();
    email = subject + '@example.com';
    idToken = await fixture.token({ sub: subject, email });
    const deps = createAuthController();
    deps.googleAuthService = new GoogleAuthService(
      fixture.provider,
      new PostgresGoogleIdentityRepository(),
    );
    const driver = new DriverController(
      new DriverService(new PostgresDriverRepository(pool)),
      {} as RideService,
      {} as DriverDocumentStorageService,
    );
    app = express();
    app.use(express.json(), cookieParser());
    app.use('/auth', createAuthRouter(deps, { enableRateLimiting: false }));
    app.get('/rides/driver/profile', requireAuth, requireDriver(), driver.getProfile);
    app.post('/rides/driver/profile', requireAuth, requireDriver(), driver.upsertProfile);
    app.patch('/rides/driver/availability', requireAuth, requireDriver(), driver.availability);
    app.use(errorMiddleware);
  });
  afterEach(async () => {
    const ids = (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows.map(
      (r) => r.id,
    );
    await pool.query('DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])', [
      ids,
    ]);
    await pool.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id=ANY($1::uuid[])', [ids]);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM pending_signups WHERE contact_value=$1',
          [email],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM login_challenges WHERE user_id=ANY($1::uuid[])',
          [ids],
        )
      ).rows[0].count,
    ).toBe(0);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
  });
  async function existing(role = 'driver') {
    return (
      await pool.query(
        "INSERT INTO users(first_name,last_name,email,role) VALUES('Existing','Driver',$1,$2) RETURNING id",
        [email, role],
      )
    ).rows[0].id as string;
  }
  function authenticate(driverFlow: 'signup' | 'signin') {
    return request(app).post('/auth/google').send({ idToken, driverFlow });
  }
  it('authenticates a Driver with missing Google name claims without OTP or invented names', async () => {
    idToken = await fixture.token({
      sub: subject,
      email,
      given_name: undefined,
      family_name: undefined,
    });
    const signup = await authenticate('signup');
    expect(signup.status).toBe(200);
    const user = (
      await pool.query('SELECT first_name,last_name,email_verified,role FROM users WHERE id=$1', [
        signup.body.data.userId,
      ])
    ).rows[0];
    expect(user).toEqual({ first_name: '', last_name: '', email_verified: true, role: 'driver' });
    const signin = await authenticate('signin');
    expect(signin.status).toBe(200);
    expect(signin.body.data.userId).toBe(signup.body.data.userId);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM driver_profiles WHERE user_id=$1', [
          signup.body.data.userId,
        ])
      ).rows[0].count,
    ).toBe(0);
  });
  async function link(id: string, role = 'driver') {
    return request(app)
      .post('/auth/google/link')
      .set('Authorization', 'Bearer ' + (await signAccessToken({ sub: id, role, type: 'access' })))
      .set('Cookie', env.AUTH_CSRF_COOKIE_NAME + '=fixture-csrf')
      .set('X-CSRF-Token', 'fixture-csrf')
      .send({ idToken });
  }
  it('creates an unapproved Driver, requires a licence, retains pending state across sign-in and forbids availability', async () => {
    const signup = await authenticate('signup');
    expect(signup.status).toBe(200);
    const { accessToken, userId } = signup.body.data;
    expect(await verifyAccessToken(accessToken)).toMatchObject({ sub: userId, role: 'driver' });
    const auth = 'Bearer ' + accessToken;
    const initial = await request(app).get('/rides/driver/profile').set('Authorization', auth);
    expect(initial.status).toBe(404);
    expect(initial.body.error.code).toBe('DRIVER_PROFILE_NOT_FOUND');
    expect(
      (await request(app).post('/rides/driver/profile').set('Authorization', auth).send({})).status,
    ).toBe(400);
    const profile = await request(app)
      .post('/rides/driver/profile')
      .set('Authorization', auth)
      .send({
        licenseNumber: 'FIXTURE-' + subject.slice(-12),
        licenseExpiry: '2099-12-31',
        city: 'Fixture City',
      });
    expect(profile.status).toBe(200);
    expect(profile.body.data.verificationStatus).toBe('pending');
    expect(
      (
        await request(app).post('/rides/driver/profile').set('Authorization', auth).send({
          licenseNumber: 'FIXTURE',
          licenseExpiry: '2099-12-31',
          verificationStatus: 'approved',
        })
      ).status,
    ).toBe(400);
    const availability = await request(app)
      .patch('/rides/driver/availability')
      .set('Authorization', auth)
      .send({ status: 'available' });
    expect(availability.status).toBe(403);
    expect(availability.body.error.code).toBe('DRIVER_NOT_ELIGIBLE');
    const signin = await authenticate('signin');
    expect(signin.status).toBe(200);
    expect(signin.body.data.userId).toBe(userId);
    const read = await request(app)
      .get('/rides/driver/profile')
      .set('Authorization', 'Bearer ' + signin.body.data.accessToken);
    expect(read.body.data.verificationStatus).toBe('pending');
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(1);
  });
  it.each(['driver', 'fleet_owner', 'driver_fleet_owner'])(
    'links an existing %s without creating another account or changing its role',
    async (role) => {
      const id = await existing(role);
      expect((await authenticate('signup')).status).toBe(409);
      expect((await link(id, role)).status).toBe(200);
      for (const flow of ['signup', 'signin'] as const) {
        const result = await authenticate(flow);
        expect(result.status).toBe(200);
        expect(await verifyAccessToken(result.body.data.accessToken)).toMatchObject({
          sub: id,
          role,
        });
      }
      expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(1);
    },
  );
  it.each(['driver', 'fleet_owner', 'driver_fleet_owner'] as const)(
    'creates only the selected %s identity, without approval, and reuses it on sign-in',
    async (providerRole) => {
      const body = { idToken, driverFlow: 'signup', providerRole };
      const signup = await request(app).post('/auth/google').send(body);
      expect(signup.status).toBe(200);
      const id = signup.body.data.userId;
      expect(await verifyAccessToken(signup.body.data.accessToken)).toMatchObject({
        sub: id,
        role: providerRole,
      });
      expect(
        (await pool.query('SELECT id FROM driver_profiles WHERE user_id=$1', [id])).rowCount,
      ).toBe(0);
      expect((await pool.query('SELECT id FROM partners WHERE user_id=$1', [id])).rowCount).toBe(0);
      const signin = await authenticate('signin');
      expect(signin.status).toBe(200);
      expect(signin.body.data.userId).toBe(id);
      expect((await request(app).post('/auth/google').send(body)).body.data.userId).toBe(id);
      const otherRole = providerRole === 'driver' ? 'fleet_owner' : 'driver';
      const mismatch = await request(app)
        .post('/auth/google')
        .send({ ...body, providerRole: otherRole });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.error.code).toBe('GOOGLE_PROVIDER_ROLE_MISMATCH');
      expect((await pool.query('SELECT role FROM users WHERE id=$1', [id])).rows[0].role).toBe(
        providerRole,
      );
      expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(1);
    },
  );
  it('preserves customer Google authentication without provider intent', async () => {
    const signup = await request(app).post('/auth/google').send({ idToken });
    expect(signup.status).toBe(200);
    const id = signup.body.data.userId;
    expect(await verifyAccessToken(signup.body.data.accessToken)).toMatchObject({
      sub: id,
      role: 'customer',
    });
    const signin = await request(app).post('/auth/google').send({ idToken });
    expect(signin.status).toBe(200);
    expect(signin.body.data.userId).toBe(id);
    expect((await authenticate('signup')).status).toBe(403);
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(1);
  });
  it('never creates an account through sign-in alone', async () => {
    const response = await authenticate('signin');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('GOOGLE_DRIVER_ACCOUNT_NOT_FOUND');
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(0);
  });
  it('does not promote a linked customer to Driver', async () => {
    const id = await existing('customer');
    expect((await link(id, 'customer')).status).toBe(200);
    for (const flow of ['signup', 'signin'] as const) {
      const response = await authenticate(flow);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('GOOGLE_DRIVER_ROLE_REQUIRED');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect((await pool.query('SELECT role FROM users WHERE id=$1', [id])).rows[0].role).toBe(
      'customer',
    );
  });
  it('serializes parallel Driver signup requests to one account and identity', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => authenticate('signup')));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(new Set(responses.map((r) => r.body.data.userId)).size).toBe(1);
    expect(
      (
        await pool.query('SELECT user_id FROM auth_external_identities WHERE provider_subject=$1', [
          subject,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it.each([
    { driverFlow: 'admin' },
    { driverFlow: 'signup', providerRole: 'admin' },
    { driverFlow: 'signin', providerRole: 'driver' },
    { providerRole: 'driver' },
    { driverFlow: 'signup', role: 'admin' },
    { driverFlow: 'signup', verificationStatus: 'approved' },
  ])('rejects invalid intent and injected privileges %j', async (body) => {
    expect(
      (
        await request(app)
          .post('/auth/google')
          .send({ idToken, ...body })
      ).status,
    ).toBe(400);
  });
  it('rejects a suspended linked Driver without issuing a session', async () => {
    const id = await existing();
    expect((await link(id)).status).toBe(200);
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [id]);
    const response = await authenticate('signin');
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
