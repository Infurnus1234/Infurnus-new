import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import type { OtpProvider } from '../providers/otp.provider.js';
import { GoogleAuthService } from '../services/google-auth.service.js';
import { googleTokenFixture } from './google-token.fixture.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireDriver } from '../middleware/authorization.middleware.js';
import { RoleEnrolmentRepository } from '../../providers/repositories/role-enrolment.repository.js';
import { env } from '../../../config/env.js';

const pass = 'Fixture-password-2026!';
const sent: string[] = [];
const send = async (contact: string) => {
  sent.push(contact);
  return {
    sessionId: randomUUID(),
    sessionToken: randomUUID(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
};
const verify = async (_token: string, otp: string) => ({
  verified: otp === '123456',
  attemptsRemaining: null,
});
const provider = {
  sendSmsOtp: send,
  sendEmailOtp: send,
  verifySmsOtp: verify,
  verifyEmailOtp: verify,
  resendSmsOtp: send,
  resendEmailOtp: send,
} as OtpProvider;
const fixture = googleTokenFixture();
let app: ReturnType<typeof express>, email: string, phone: string, prefix: string;
beforeEach(() => {
  prefix = 'scoped-' + randomUUID();
  email = prefix + '@example.com';
  phone =
    '+91' +
    String(
      (BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 10)) % 9000000000n) + 1000000000n,
    );
  sent.length = 0;
  const deps = createAuthController(provider);
  deps.googleAuthService = new GoogleAuthService(fixture.provider);
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', createAuthRouter(deps, { enableRateLimiting: false }));
  app.get('/driver-only', requireAuth, requireDriver(), (req, res) =>
    res.json({ id: req.auth!.userId, role: req.auth!.role }),
  );
  app.use(errorMiddleware);
});
afterEach(async () => {
  const ids = (
    await pool.query('SELECT id FROM users WHERE email LIKE $1 OR phone=$2', [prefix + '%', phone])
  ).rows.map((r) => r.id);
  if (ids.length) {
    await pool.query(
      'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[]) OR fleet_id IN (SELECT id FROM partners WHERE user_id=ANY($1::uuid[]))',
      [ids],
    );
    for (const table of [
      'refresh_tokens',
      'login_challenges',
      'password_reset_challenges',
      'provider_onboarding',
      'partners',
      'driver_profiles',
    ])
      await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
  }
  await pool.query('DELETE FROM pending_signups WHERE email LIKE $1 OR contact_value=$2', [
    prefix + '%',
    phone,
  ]);
});
async function signup(role: string, contacts: object = { email }) {
  const start = await request(app)
    .post('/auth/signup')
    .send({
      firstName: 'Scoped',
      lastName: 'Fixture',
      role,
      ...contacts,
      ...(['driver', 'driver_fleet_owner'].includes(role)
        ? { onboardingLicencePending: true }
        : {}),
      ...(['fleet_owner', 'driver_fleet_owner'].includes(role)
        ? { businessName: 'Fixture Fleet', password: pass, confirmPassword: pass }
        : {}),
    });
  if (start.status === 409) {
    expect(start.body.error.code).toBe('SIGNUP_ALREADY_PENDING');
    return start;
  }
  expect(start.status).toBe(201);
  return request(app)
    .post('/auth/signup/verify')
    .send({ signupId: start.body.data.signupId, otp: '123456' });
}
async function login(role?: string, contacts: object = { email }) {
  const start = await request(app)
    .post('/auth/login')
    .send({
      ...contacts,
      ...(role ? { role } : {}),
      ...(['fleet_owner', 'driver_fleet_owner'].includes(role ?? '') ? { password: pass } : {}),
    });
  if (start.status !== 200 || !start.body.data.challengeId) return start;
  return request(app)
    .post('/auth/login/verify')
    .send({ challengeId: start.body.data.challengeId, otp: '123456' });
}
describe('Role-scoped verified account identities', () => {
  it.each(['driver', 'fleet_owner', 'driver_fleet_owner'])(
    'same verified email creates isolated customer and %s accounts',
    async (role) => {
      const a = await signup('customer'),
        b = await signup(role);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.data.userId).not.toBe(b.body.data.userId);
      expect((await login('customer')).body.data.userId).toBe(a.body.data.userId);
      expect((await login(role)).body.data.userId).toBe(b.body.data.userId);
      expect(
        (await pool.query('SELECT email_verified FROM users WHERE email=$1', [email])).rows.every(
          (r) => r.email_verified,
        ),
      ).toBe(true);
    },
  );
  it.each([{ phoneOnly: true }, { phoneOnly: false }])(
    'same normalized phone across roles and optional same email: %j',
    async ({ phoneOnly }) => {
      const contacts = phoneOnly ? { phone } : { phone, email };
      const a = await signup('customer', contacts),
        b = await signup('driver', contacts);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.data.userId).not.toBe(b.body.data.userId);
      if (!phoneOnly) {
        const rows = (
          await pool.query(
            'SELECT email,phone,email_verified,phone_verified FROM users WHERE phone=$1',
            [phone],
          )
        ).rows;
        expect(rows).toHaveLength(2);
        expect(
          rows.every(
            (r) => r.email === email && r.phone === phone && r.phone_verified && !r.email_verified,
          ),
        ).toBe(true);
      }
      for (const [role, id] of [
        ['customer', a.body.data.userId],
        ['driver', b.body.data.userId],
      ])
        expect((await login(role, { phone: phone.slice(1) })).body.data.userId).toBe(id);
    },
  );
  it('missing role is rejected for shared contacts before delivery, single-account legacy login works', async () => {
    const a = await signup('customer');
    expect((await login()).body.data.userId).toBe(a.body.data.userId);
    await signup('driver');
    const count = sent.length;
    const ambiguous = await request(app).post('/auth/login').send({ email });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error.code).toBe('ACCOUNT_ROLE_REQUIRED');
    expect(sent.length).toBe(count);
  });
  it('same role duplicate cannot verify another signup or create a second account', async () => {
    const a = await signup('customer');
    expect(a.status).toBe(200);
    const b = await signup('customer');
    expect(b.status).toBe(400);
    expect(
      (await pool.query("SELECT id FROM users WHERE email=$1 AND role='customer'", [email]))
        .rowCount,
    ).toBe(1);
  });
  it('concurrent same-role signup produces exactly one verifiable account', async () => {
    const results = await Promise.all([signup('customer'), signup('customer')]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(1);
  });
  it('concurrent different-role signup does not reserve the contact globally', async () => {
    const results = await Promise.all([
      signup('customer'),
      signup('driver'),
      signup('fleet_owner'),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.data.userId)).size).toBe(3);
  });
  it('database rejects same-role normalized contact aliases while allowing different roles', async () => {
    await signup('customer', { phone, email });
    await expect(
      pool.query(
        "INSERT INTO users(first_name,last_name,email,role) VALUES('X','Y',$1,'customer')",
        [email.toUpperCase()],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        "INSERT INTO users(first_name,last_name,phone,role) VALUES('X','Y',$1,'customer')",
        [phone.slice(1)],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    expect((await signup('driver', { phone, email })).status).toBe(200);
  });
  it('OTP challenges remain account-bound, invalid and reused codes cannot switch roles', async () => {
    const a = await signup('customer'),
      b = await signup('driver');
    const start = await request(app).post('/auth/login').send({ email, role: 'driver' });
    expect(
      (
        await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: start.body.data.challengeId, otp: '000000' })
      ).status,
    ).toBe(400);
    const valid = await request(app)
      .post('/auth/login/verify')
      .send({ challengeId: start.body.data.challengeId, otp: '123456' });
    expect(valid.body.data.userId).toBe(b.body.data.userId);
    expect(valid.body.data.userId).not.toBe(a.body.data.userId);
    expect(
      (
        await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: start.body.data.challengeId, otp: '123456' })
      ).status,
    ).not.toBe(200);
  });
  it('customer JWT is denied Driver scope and account JWTs carry distinct subjects', async () => {
    const a = await signup('customer'),
      b = await signup('driver');
    expect((await verifyAccessToken(a.body.data.accessToken)).sub).not.toBe(
      (await verifyAccessToken(b.body.data.accessToken)).sub,
    );
    expect(
      (
        await request(app)
          .get('/driver-only')
          .set('Authorization', 'Bearer ' + a.body.data.accessToken)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/driver-only')
          .set('Authorization', 'Bearer ' + b.body.data.accessToken)
      ).body.id,
    ).toBe(b.body.data.userId);
  });
  it('Google verified subject creates separate explicit-role accounts and refuses ambiguity', async () => {
    const idToken = await fixture.token({ sub: prefix, email });
    const results = [];
    for (const role of ['customer', 'driver', 'fleet_owner']) {
      const r = await request(app)
        .post('/auth/google')
        .send({
          idToken,
          accountRole: role,
          ...(role === 'customer' ? {} : { driverFlow: 'signup' }),
        });
      expect(r.status).toBe(200);
      results.push(r);
      const again = await request(app)
        .post('/auth/google')
        .send({
          idToken,
          accountRole: role,
          ...(role === 'customer' ? {} : { driverFlow: 'signin' }),
        });
      expect(again.body.data.userId).toBe(r.body.data.userId);
    }
    expect(new Set(results.map((r) => r.body.data.userId)).size).toBe(3);
    const ambiguous = await request(app).post('/auth/google').send({ idToken });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error.code).toBe('ACCOUNT_ROLE_REQUIRED');
    expect(
      (await request(app).post('/auth/google').send({ idToken, accountRole: 'admin' })).status,
    ).toBe(403);
  });
  it('concurrent Google requests create only one account within a role', async () => {
    const idToken = await fixture.token({ sub: prefix, email });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).post('/auth/google').send({ idToken, accountRole: 'customer' }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.userId)).size).toBe(1);
  });
  it('recovery resolves explicit role and resets only its account/session', async () => {
    await signup('customer');
    const fleet = await signup('fleet_owner'),
      combined = await signup('driver_fleet_owner');
    const ambiguous = await request(app).post('/auth/forgot-password').send({ email });
    expect(ambiguous.status).toBe(409);
    const reset = await request(app)
      .post('/auth/forgot-password')
      .send({ email, role: 'fleet_owner' });
    expect(reset.status).toBe(200);
    const t = reset.body.data.resetSessionToken;
    expect(
      (
        await request(app)
          .post('/auth/forgot-password/verify')
          .send({ resetSessionToken: t, otp: '123456' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app).post('/auth/reset-password').send({
          resetSessionToken: t,
          password: 'Changed-password-2026!',
          confirmPassword: 'Changed-password-2026!',
        })
      ).status,
    ).toBe(200);
    const rows = await pool.query(
      'SELECT user_id,revoked_at FROM refresh_tokens WHERE user_id=ANY($1::uuid[])',
      [[fleet.body.data.userId, combined.body.data.userId]],
    );
    expect(
      rows.rows.filter((r) => r.user_id === fleet.body.data.userId).every((r) => r.revoked_at),
    ).toBe(true);
    expect(
      rows.rows.filter((r) => r.user_id === combined.body.data.userId).every((r) => !r.revoked_at),
    ).toBe(true);
  });
  it('suspended explicit role cannot fall back into another active role', async () => {
    const a = await signup('customer');
    await signup('driver');
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [a.body.data.userId]);
    expect((await login('customer')).status).toBe(401);
    expect((await login('driver')).status).toBe(200);
  });
  it('refresh and logout keep the selected account UUID when contacts are shared', async () => {
    const customer = await signup('customer'),
      driver = await signup('driver');
    const cookies = customer.headers['set-cookie'] as unknown as string[];
    const csrfCookie = cookies.find((x) => x.startsWith(env.AUTH_CSRF_COOKIE_NAME + '='))!;
    const csrf = csrfCookie.split(';')[0]!.slice(env.AUTH_CSRF_COOKIE_NAME.length + 1);
    const refresh = await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(refresh.status).toBe(200);
    expect(await verifyAccessToken(refresh.body.data.accessToken)).toMatchObject({
      sub: customer.body.data.userId,
      role: 'customer',
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL',
          [driver.body.data.userId],
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
  });
  it('provisional role change cascades Google binding and refuses a same-role identity collision', async () => {
    const token = await fixture.token({ sub: prefix, email });
    const provisional = await request(app)
      .post('/auth/google')
      .send({ idToken: token, driverFlow: 'signup' });
    expect(provisional.status).toBe(200);
    const id = provisional.body.data.userId,
      repo = new RoleEnrolmentRepository(pool);
    await repo.selectRole(id, 'driver', 'fleet_owner');
    expect(
      (await pool.query('SELECT account_role FROM auth_external_identities WHERE user_id=$1', [id]))
        .rows[0].account_role,
    ).toBe('fleet_owner');
    const again = await request(app)
      .post('/auth/google')
      .send({ idToken: token, driverFlow: 'signin', accountRole: 'fleet_owner' });
    expect(again.body.data.userId).toBe(id);
    await expect(
      pool.query("UPDATE auth_external_identities SET account_role='driver' WHERE user_id=$1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('an unverified secondary contact cannot authenticate the same-role account', async () => {
    const a = await signup('customer', { phone, email });
    expect(a.status).toBe(200);
    const emailAttempt = await login('customer', { email });
    expect(emailAttempt.status).toBe(400);
    expect((await login('customer', { phone })).body.data.userId).toBe(a.body.data.userId);
  });
  it('provisional role choice cannot overwrite another existing role account', async () => {
    const driver = await signup('driver'),
      fleet = await signup('fleet_owner');
    await pool.query(
      'UPDATE provider_onboarding SET role_selection_pending=TRUE WHERE user_id=$1',
      [driver.body.data.userId],
    );
    const repo = new RoleEnrolmentRepository(pool);
    await expect(
      repo.selectRole(driver.body.data.userId, 'driver', 'fleet_owner'),
    ).rejects.toMatchObject({ code: 'ACCOUNT_ROLE_EXISTS' });
    expect((await pool.query('SELECT id,role FROM users WHERE email=$1', [email])).rows).toEqual(
      expect.arrayContaining([
        { id: driver.body.data.userId, role: 'driver' },
        { id: fleet.body.data.userId, role: 'fleet_owner' },
      ]),
    );
  });
  it('unverified secondary Fleet email cannot become a password recovery identity', async () => {
    const fleet = await signup('fleet_owner', { phone, email });
    expect(fleet.status).toBe(200);
    const count = sent.length;
    const reset = await request(app)
      .post('/auth/forgot-password')
      .send({ email, role: 'fleet_owner' });
    expect(reset.status).toBe(200);
    expect(sent).toHaveLength(count);
    expect(
      (
        await pool.query('SELECT id FROM password_reset_challenges WHERE user_id=$1', [
          fleet.body.data.userId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await request(app)
          .post('/auth/forgot-password/verify')
          .send({ resetSessionToken: reset.body.data.resetSessionToken, otp: '123456' })
      ).status,
    ).toBe(400);
  });
});
