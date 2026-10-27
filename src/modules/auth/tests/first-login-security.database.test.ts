import { randomInt, randomUUID, generateKeyPairSync } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Response } from 'supertest';
import { SignJWT } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAuthTestRateLimits } from './reset-auth-rate-limits.js';
import { env } from '../../../config/env.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import type { OtpProvider } from '../providers/otp.provider.js';
import { GoogleAuthService } from '../services/google-auth.service.js';
import { PostgresGoogleIdentityRepository } from '../repositories/google-identity.repository.js';
import { googleTokenFixture } from './google-token.fixture.js';
import { createProviderOperationsRouter } from '../../providers/routes/provider-operations.routes.js';
import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
import { createUserRouter } from '../../users/routes/user.routes.js';
import { UserController } from '../../users/controllers/user.controller.js';
import { UserService } from '../../users/services/user.service.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';
import { PostgresRefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import { LogoutService } from '../services/logout.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireDriver } from '../middleware/authorization.middleware.js';
import { DriverService } from '../../rides/services/driver.service.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { FleetController } from '../../fleet/controllers/fleet.controller.js';
import { FleetService } from '../../fleet/services/fleet.service.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { createFleetRouter } from '../../fleet/routes/fleet.routes.js';

// Only delivery is replaced. Distinct per-challenge codes, contact/channel binding,
// expiry and idempotent provider responses exercise real local consumption guards.
class AuditOtpDelivery implements OtpProvider {
  afterVerification: (() => Promise<void>) | undefined;
  readonly sessions = new Map<
    string,
    { channel: string; contact: string; code: string; expiresAt: string }
  >();
  sends = 0;
  private async send(contact: string, channel: string) {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 600000).toISOString();
    this.sessions.set(token, {
      channel,
      contact,
      code: String(100000 + (this.sends++ % 899999)),
      expiresAt,
    });
    return { sessionId: randomUUID(), sessionToken: token, expiresAt };
  }
  code(contact: string) {
    return [...this.sessions.values()].filter((s) => s.contact === contact).at(-1)!.code;
  }
  private async verify(token: string, code: string, channel: string) {
    const session = this.sessions.get(token);
    if (this.afterVerification) await this.afterVerification();
    return {
      verified:
        !!session &&
        session.channel === channel &&
        session.code === code &&
        Date.parse(session.expiresAt) > Date.now(),
      attemptsRemaining: 4,
    };
  }
  async sendSmsOtp(contact: string) {
    return this.send(contact, 'sms');
  }
  async sendEmailOtp(contact: string) {
    return this.send(contact, 'email');
  }
  async verifySmsOtp(token: string, code: string) {
    return this.verify(token, code, 'sms');
  }
  async verifyEmailOtp(token: string, code: string) {
    return this.verify(token, code, 'email');
  }
  async resendSmsOtp(token: string) {
    return { expiresAt: this.sessions.get(token)!.expiresAt };
  }
  async resendEmailOtp(token: string) {
    return { expiresAt: this.sessions.get(token)!.expiresAt };
  }
}

describe.runIf(process.env.AUTH_SECURITY_AUDIT_TESTS === 'true')(
  'first login and provider security audit — actual routes and database',
  () => {
    const delivery = new AuditOtpDelivery();
    const google = googleTokenFixture();
    const deps = createAuthController(delivery);
    deps.googleAuthService = new GoogleAuthService(
      google.provider,
      new PostgresGoogleIdentityRepository(),
    );
    const app = express();
    app.use(express.json(), cookieParser());
    app.use('/auth', createAuthRouter(deps));
    app.use(
      '/users',
      createUserRouter(
        new UserController(
          new UserService(
            new PostgresUserRepository(pool),
            new LogoutService(new PostgresRefreshTokenRepository()),
          ),
        ),
      ),
    );
    const operations = new PostgresProviderOperationsRepository(pool);
    app.use(
      '/provider',
      requireAuth,
      async (req, _res, next) => {
        try {
          await operations.authorize(req.auth!.userId, req.auth!.role);
          next();
        } catch (e) {
          next(e);
        }
      },
      createProviderOperationsRouter(operations),
    );
    app.use(
      '/fleet',
      createFleetRouter(new FleetController(new FleetService(new PostgresFleetRepository(pool)))),
    );
    const driver = new DriverService(new PostgresDriverRepository(pool));
    app.get('/rides/driver/profile', requireAuth, requireDriver(), async (req, res, next) => {
      try {
        res.json({ success: true, data: await driver.getProfile(req.auth!.userId) });
      } catch (e) {
        next(e);
      }
    });
    app.use(errorMiddleware);
    beforeAll(() => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Disposable audit database required');
    });
    beforeEach(resetAuthTestRateLimits);

    const phone = () => '+91' + randomInt(6000000000, 9999999999);
    const email = () => `audit-${randomUUID()}@example.test`;
    function cookies(r: Response) {
      return ((r.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]!);
    }
    function csrf(r: Response) {
      const c = cookies(r).find((c) => c.startsWith(env.AUTH_CSRF_COOKIE_NAME + '='));
      return c ? decodeURIComponent(c.slice(c.indexOf('=') + 1)) : '';
    }
    function refreshCookies(r: Response) {
      return cookies(r).filter((c) => c.startsWith(env.AUTH_REFRESH_COOKIE_NAME + '='));
    }
    async function sessionCount() {
      return Number((await pool.query('SELECT count(*) AS n FROM refresh_tokens')).rows[0].n);
    }
    function noCredential(r: Response) {
      expect(typeof r.body?.data?.accessToken === 'string').toBe(false);
      expect(refreshCookies(r).length).toBe(0);
    }
    async function deniedBearer(candidate?: string) {
      for (const [method, path] of [
        ['get', '/provider/account'],
        ['patch', '/provider/account'],
        ['post', '/provider/vehicle-catalog/custom'],
        ['get', '/fleet/vehicles'],
        ['post', '/fleet/vehicles'],
        ['get', '/rides/driver/profile'],
      ] as const) {
        const r = request(app)[method](path);
        if (candidate) r.set('Authorization', 'Bearer ' + candidate);
        if (method !== 'get') r.send({ firstName: 'Unauthorized' });
        expect((await r).status).toBe(401);
      }
    }
    async function pending(kind: 'phone' | 'email', role = 'driver') {
      const contact = kind === 'phone' ? phone() : email();
      const body = {
        firstName: 'Audit',
        lastName: 'Fixture',
        [kind]: contact,
        role,
        ...(role === 'driver'
          ? { onboardingLicencePending: true }
          : {
              password: 'Audit-fixture-pass-42!',
              confirmPassword: 'Audit-fixture-pass-42!',
              businessName: 'Audit fixture',
            }),
      };
      const r = await request(app).post('/auth/signup').send(body);
      expect(r.status).toBe(201);
      noCredential(r);
      return { contact, signupId: r.body.data.signupId as string, role };
    }
    async function signup(kind: 'phone' | 'email', role = 'driver') {
      const p = await pending(kind, role);
      const r = await request(app)
        .post('/auth/signup/verify')
        .send({ signupId: p.signupId, otp: delivery.code(p.contact) });
      expect(r.status).toBe(200);
      expect(typeof r.body.data.accessToken === 'string').toBe(true);
      return {
        ...p,
        response: r,
        id: r.body.data.userId as string,
        token: r.body.data.accessToken as string,
      };
    }
    async function account(token: string) {
      return request(app)
        .get('/provider/account')
        .set('Authorization', 'Bearer ' + token);
    }
    async function claimsUser(id: string) {
      return (
        await pool.query(
          'SELECT email,phone,email_verified,phone_verified FROM users WHERE id=$1',
          [id],
        )
      ).rows[0];
    }

    it('unknown first-time phone login returns only a non-authenticating challenge', async () => {
      const before = await sessionCount();
      const r = await request(app).post('/auth/login').send({ phone: phone(), role: 'driver' });
      expect(r.status).toBe(200);
      noCredential(r);
      const id = r.body.data.challengeId;
      await deniedBearer(id);
      expect(
        (await request(app).post('/auth/login/verify').send({ challengeId: id, otp: '000000' }))
          .status,
      ).toBe(400);
      expect(await sessionCount()).toBe(before);
    });
    for (const kind of ['phone', 'email'] as const) {
      it(`${kind} pending signup has no account/session and cannot access protected APIs`, async () => {
        const before = await sessionCount();
        const p = await pending(kind);
        expect(
          (await pool.query('SELECT id FROM users WHERE email=$1 OR phone=$1', [p.contact]))
            .rowCount,
        ).toBe(0);
        await deniedBearer(p.signupId);
        const login = await request(app)
          .post('/auth/login')
          .send({ [kind]: p.contact, role: 'driver' });
        noCredential(login);
        expect(await sessionCount()).toBe(before);
      });
      it(`${kind} missing and incorrect signup OTPs leave no usable session`, async () => {
        const before = await sessionCount();
        const p = await pending(kind);
        for (const body of [{ signupId: p.signupId }, { signupId: p.signupId, otp: '000000' }]) {
          const r = await request(app).post('/auth/signup/verify').send(body);
          expect(r.status).toBe(400);
          noCredential(r);
        }
        expect(await sessionCount()).toBe(before);
        await deniedBearer(p.signupId);
      });
      it(`${kind} expired signup challenge is rejected`, async () => {
        const p = await pending(kind);
        const before = await sessionCount();
        await pool.query(
          "UPDATE pending_signups SET otp_provider_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
          [p.signupId],
        );
        const r = await request(app)
          .post('/auth/signup/verify')
          .send({ signupId: p.signupId, otp: delivery.code(p.contact) });
        expect(r.status).toBe(400);
        noCredential(r);
        expect(await sessionCount()).toBe(before);
      });
      it(`${kind} OTP belonging to another contact cannot complete signup`, async () => {
        const a = await pending(kind);
        const b = await pending(kind);
        const before = await sessionCount();
        const r = await request(app)
          .post('/auth/signup/verify')
          .send({ signupId: a.signupId, otp: delivery.code(b.contact) });
        expect(r.status).toBe(400);
        noCredential(r);
        expect(await sessionCount()).toBe(before);
      });
      it(`${kind} successful signup cannot be replayed or reused as a refresh token`, async () => {
        const a = await signup(kind);
        const before = await sessionCount();
        const replay = await request(app)
          .post('/auth/signup/verify')
          .send({ signupId: a.signupId, otp: delivery.code(a.contact) });
        expect(replay.status).toBe(400);
        noCredential(replay);
        expect(await sessionCount()).toBe(before);
        const r = await request(app)
          .post('/auth/refresh')
          .set('Cookie', [
            `${env.AUTH_REFRESH_COOKIE_NAME}=${a.signupId}`,
            `${env.AUTH_CSRF_COOKIE_NAME}=audit-csrf`,
          ])
          .set('X-CSRF-Token', 'audit-csrf');
        expect(r.status).toBe(401);
        noCredential(r);
        expect((await account(a.token)).status).toBe(200);
      });
    }
    for (const role of ['driver', 'fleet_owner']) {
      it(`${role} email/password login still requires OTP and rejects incorrect credentials when applicable`, async () => {
        const a = await signup('email', role);
        const before = await sessionCount();
        if (role === 'fleet_owner')
          expect(
            (
              await request(app)
                .post('/auth/login')
                .send({ email: a.contact, password: 'incorrect-fixture', role })
            ).status,
          ).toBe(401);
        const r = await request(app)
          .post('/auth/login')
          .send({
            email: a.contact,
            role,
            ...(role === 'fleet_owner' ? { password: 'Audit-fixture-pass-42!' } : {}),
          });
        expect(r.status).toBe(200);
        noCredential(r);
        expect(await sessionCount()).toBe(before);
        const challengeId = r.body.data.challengeId;
        const wrong = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId, otp: '000000' });
        expect(wrong.status).toBe(400);
        noCredential(wrong);
        await deniedBearer(challengeId);
        const verified = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId, otp: delivery.code(a.contact) });
        expect(verified.status).toBe(200);
        expect((await account(verified.body.data.accessToken)).status).toBe(200);
        const replay = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId, otp: delivery.code(a.contact) });
        expect(replay.status).toBe(400);
        noCredential(replay);
      });
    }
    it('phone login rejects an expired challenge, a cross-phone OTP and repeated attempts', async () => {
      const a = await signup('phone');
      const b = await signup('phone');
      const first = await request(app)
        .post('/auth/login')
        .send({ phone: a.contact, role: 'driver' });
      const second = await request(app)
        .post('/auth/login')
        .send({ phone: b.contact, role: 'driver' });
      const before = await sessionCount();
      const crossed = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId: first.body.data.challengeId, otp: delivery.code(b.contact) });
      expect(crossed.status).toBe(400);
      noCredential(crossed);
      await pool.query(
        "UPDATE login_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [second.body.data.challengeId],
      );
      const expired = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId: second.body.data.challengeId, otp: delivery.code(b.contact) });
      expect(expired.status).toBe(400);
      noCredential(expired);
      expect(await sessionCount()).toBe(before);
    });

    it('OTP attempt exhaustion prevents even a subsequently correct code from authenticating', async () => {
      const a = await signup('phone');
      const login = await request(app)
        .post('/auth/login')
        .send({ phone: a.contact, role: 'driver' });
      const challengeId = login.body.data.challengeId;
      const before = await sessionCount();
      for (let i = 0; i < env.AUTH_OTP_MAX_ATTEMPTS; i++) {
        const r = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId, otp: '000000' });
        expect(r.status).toBe(400);
        noCredential(r);
      }
      const exhausted = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId, otp: delivery.code(a.contact) });
      expect(exhausted.status).toBe(429);
      noCredential(exhausted);
      expect(await sessionCount()).toBe(before);
      await deniedBearer(challengeId);
    });

    it('signup expiring during provider verification cannot create an account or session', async () => {
      const p = await pending('phone');
      const before = await sessionCount();
      delivery.afterVerification = async () => {
        await pool.query(
          "UPDATE pending_signups SET otp_provider_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
          [p.signupId],
        );
      };
      let r: Response;
      try {
        r = await request(app)
          .post('/auth/signup/verify')
          .send({ signupId: p.signupId, otp: delivery.code(p.contact) });
      } finally {
        delivery.afterVerification = undefined;
      }
      expect(r.status).toBe(400);
      noCredential(r);
      expect(await sessionCount()).toBe(before);
      expect((await pool.query('SELECT id FROM users WHERE phone=$1', [p.contact])).rowCount).toBe(
        0,
      );
    });

    it('a login challenge expiring while consumption waits on a database lock is denied', async () => {
      const a = await signup('phone');
      const login = await request(app)
        .post('/auth/login')
        .send({ phone: a.contact, role: 'driver' });
      const challengeId = login.body.data.challengeId;
      const before = await sessionCount();
      const locker = await pool.connect();
      await locker.query('BEGIN');
      delivery.afterVerification = async () => {
        await locker.query(
          "UPDATE login_challenges SET expires_at=clock_timestamp()+INTERVAL '1 second' WHERE id=$1",
          [challengeId],
        );
      };
      const verification = request(app)
        .post('/auth/login/verify')
        .send({ challengeId, otp: delivery.code(a.contact) })
        .then((r) => r);
      try {
        await vi.waitFor(
          async () => {
            const blocked = await pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()",
            );
            expect(blocked.rows[0].n > 0).toBe(true);
          },
          { timeout: 5000, interval: 25 },
        );
        await vi.waitFor(
          async () => {
            const expired = await locker.query(
              'SELECT clock_timestamp()>expires_at AS expired FROM login_challenges WHERE id=$1',
              [challengeId],
            );
            expect(expired.rows[0].expired).toBe(true);
          },
          { timeout: 5000, interval: 25 },
        );
        await locker.query('COMMIT');
      } finally {
        delivery.afterVerification = undefined;
        await locker.query('ROLLBACK');
        locker.release();
      }
      const r = await verification;
      expect(r.status).toBe(400);
      noCredential(r);
      expect(await sessionCount()).toBe(before);
    });

    it('client identity, role and verification flags cannot substitute for signup or login verification', async () => {
      const before = await sessionCount();
      for (const [path, body] of [
        [
          '/auth/signup',
          {
            firstName: 'Audit',
            lastName: 'Fixture',
            phone: phone(),
            role: 'super_admin',
            verified: true,
          },
        ],
        ['/auth/login', { phone: phone(), role: 'driver', verified: true, userId: randomUUID() }],
        ['/auth/signup/verify', { signupId: randomUUID(), verified: true }],
        ['/auth/google', { email: email(), googleId: randomUUID(), verified: true }],
      ] as const) {
        const r = await request(app).post(path).send(body);
        expect(r.status).toBe(400);
        noCredential(r);
      }
      expect(await sessionCount()).toBe(before);
    });

    it('refresh-cookie possession alone does not authorize a protected provider request', async () => {
      const a = await signup('email');
      const original = await claimsUser(a.id);
      for (const method of ['get', 'patch'] as const) {
        const client = request(app);
        const r = client[method]('/provider/account')
          .set('Cookie', cookies(a.response))
          .set('X-CSRF-Token', csrf(a.response));
        if (method === 'patch') r.send({ firstName: 'Unauthorized' });
        expect((await r).status).toBe(401);
      }
      expect(await claimsUser(a.id)).toEqual(original);
    });

    it('a new backend instance restores only a valid database refresh session', async () => {
      const a = await signup('phone');
      const restoredApp = express();
      restoredApp.use(express.json(), cookieParser());
      restoredApp.use('/auth', createAuthRouter(createAuthController(delivery)));
      restoredApp.use(errorMiddleware);
      const restored = await request(restoredApp)
        .post('/auth/refresh')
        .set('Cookie', cookies(a.response))
        .set('X-CSRF-Token', csrf(a.response));
      expect(restored.status).toBe(200);
      expect((await account(restored.body.data.accessToken)).body.data.id === a.id).toBe(true);
    });
    it('direct session/token/password-reset endpoint calls cannot mint an authenticated session', async () => {
      const before = await sessionCount();
      for (const path of [
        '/auth/token',
        '/auth/session',
        '/auth/sessions',
        '/auth/login/verify',
        '/auth/signup/verify',
        '/auth/reset-password',
        '/auth/google/link',
        '/auth/change-password',
      ]) {
        const r = await request(app).post(path).send({});
        expect([400, 401, 403, 404].includes(r.status)).toBe(true);
        noCredential(r);
      }
      const r = await request(app).post('/auth/refresh').send({});
      expect(r.status).toBe(403);
      noCredential(r);
      expect(await sessionCount()).toBe(before);
      await deniedBearer();
    });
    it('Google signup accepts a cryptographically verified fixture and needs no separate OTP', async () => {
      const before = delivery.sends;
      const idToken = await google.token({ sub: randomUUID(), email: email() });
      const r = await request(app)
        .post('/auth/google')
        .send({ idToken, driverFlow: 'signup', providerRole: 'driver' });
      expect(r.status).toBe(200);
      expect((await account(r.body.data.accessToken)).status).toBe(200);
      expect(delivery.sends).toBe(before);
    });
    for (const mode of [
      'missing',
      'malformed',
      'unsigned',
      'expired',
      'wrong_audience',
      'wrong_issuer',
      'unverified_email',
      'wrong_signature',
      'client_verified_flag',
    ]) {
      it(`Google rejects ${mode} credential before any session is issued`, async () => {
        const before = await sessionCount();
        let body: Record<string, unknown> = {};
        if (mode === 'malformed') body = { idToken: 'not-a-token' };
        else if (mode === 'unsigned')
          body = { idToken: 'eyJhbGciOiJub25lIn0.eyJlbWFpbF92ZXJpZmllZCI6dHJ1ZX0.' };
        else if (mode !== 'missing') {
          const overrides: Record<string, unknown> = { sub: randomUUID(), email: email() };
          if (mode === 'expired') {
            overrides.iat = Math.floor(Date.now() / 1000) - 7200;
            overrides.exp = Math.floor(Date.now() / 1000) - 3600;
          }
          if (mode === 'wrong_audience') overrides.aud = 'untrusted-client';
          if (mode === 'wrong_issuer') overrides.iss = 'https://attacker.invalid';
          if (mode === 'unverified_email') overrides.email_verified = false;
          const key =
            mode === 'wrong_signature'
              ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
              : undefined;
          body = {
            idToken: await google.token(overrides, key),
            driverFlow: 'signup',
            providerRole: 'driver',
          };
          if (mode === 'client_verified_flag') body.verified = true;
        }
        const r = await request(app).post('/auth/google').send(body);
        expect([400, 401].includes(r.status)).toBe(true);
        noCredential(r);
        expect(await sessionCount()).toBe(before);
        await deniedBearer(typeof body.idToken === 'string' ? body.idToken : undefined);
      });
    }
    for (const [kind, field, role] of [
      ['email', 'phone', 'driver'],
      ['phone', 'email', 'driver'],
      ['email', 'phone', 'fleet_owner'],
      ['phone', 'email', 'fleet_owner'],
    ] as const) {
      it(`${kind}-authenticated ${role} can persist alternate ${field} without OTP or changing login identity`, async () => {
        const a = await signup(kind, role);
        const original = await claimsUser(a.id);
        const before = delivery.sends;
        const alternate = field === 'phone' ? phone() : email();
        const r = await request(app)
          .patch('/provider/account')
          .set('Authorization', 'Bearer ' + a.token)
          .send({ [field]: alternate });
        expect(r.status).toBe(200);
        expect((await account(a.token)).body.data[field] === alternate).toBe(true);
        expect(delivery.sends).toBe(before);
        expect(await claimsUser(a.id)).toEqual(original);
        const attempted = await request(app)
          .post('/auth/login')
          .send({
            [field]: alternate,
            role,
            ...(role === 'fleet_owner' ? { password: 'Audit-fixture-pass-42!' } : {}),
          });
        noCredential(attempted);
        expect(delivery.sends).toBe(before);
        const verified = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: attempted.body.data.challengeId, otp: '000000' });
        expect(verified.status).toBe(400);
        noCredential(verified);
      });
    }
    for (const role of ['driver', 'fleet_owner'] as const) {
      it(`${role} contacts reject identity/role/verification overrides and another owner target`, async () => {
        const a = await signup('email', role);
        const b = await signup('email', role);
        const original = await claimsUser(b.id);
        for (const body of [
          { userId: b.id, phone: phone() },
          { id: b.id },
          { role: 'super_admin' },
          { emailVerified: true },
          { phoneVerified: true },
        ]) {
          const r = await request(app)
            .patch('/provider/account')
            .set('Authorization', 'Bearer ' + a.token)
            .send(body);
          expect(r.status).toBe(400);
        }
        const other = await request(app)
          .patch('/users/' + b.id)
          .set('Authorization', 'Bearer ' + a.token)
          .send({ firstName: 'Unauthorized' });
        expect(other.status).toBe(403);
        const query = await request(app)
          .get('/provider/account?userId=' + b.id)
          .set('Authorization', 'Bearer ' + a.token);
        expect(query.status).toBe(200);
        expect(query.body.data.id === a.id).toBe(true);
        expect(await claimsUser(b.id)).toEqual(original);
      });
    }
    for (const kind of ['email', 'phone'] as const) {
      it(`legacy user profile endpoint cannot silently replace a verified ${kind} login identity`, async () => {
        const a = await signup(kind);
        const original = await claimsUser(a.id);
        const r = await request(app)
          .patch('/users/' + a.id)
          .set('Authorization', 'Bearer ' + a.token)
          .send({ [kind]: kind === 'email' ? email() : phone() });
        expect([400, 409].includes(r.status)).toBe(true);
        expect(await claimsUser(a.id)).toEqual(original);
      });
    }
    it('expired and malformed bearer credentials cannot read or write provider contacts', async () => {
      const a = await signup('phone');
      const expired = await new SignJWT({ role: 'driver', type: 'access' })
        .setSubject(a.id)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
        .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
      await deniedBearer(expired);
      await deniedBearer('invalid');
      await deniedBearer();
    });
    it('logout immediately denies the old access token on protected account and Driver routes', async () => {
      const a = await signup('phone');
      const r = await request(app)
        .post('/auth/logout')
        .set('Cookie', cookies(a.response))
        .set('X-CSRF-Token', csrf(a.response));
      expect(r.status).toBe(204);
      await deniedBearer(a.token);
      expect(
        (
          await request(app)
            .get('/rides/driver/profile')
            .set('Authorization', 'Bearer ' + a.token)
        ).status,
      ).toBe(401);
    });
    it('revoking one session denies its bearer while preserving an independent login', async () => {
      const a = await signup('phone');
      const login = await request(app)
        .post('/auth/login')
        .send({ phone: a.contact, role: 'driver' });
      const second = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId: login.body.data.challengeId, otp: delivery.code(a.contact) });
      expect(second.status).toBe(200);
      const sessions = await request(app)
        .get('/auth/sessions')
        .set('Authorization', 'Bearer ' + a.token);
      expect(sessions.status).toBe(200);
      const initial = (
        await pool.query(
          'SELECT id FROM refresh_tokens WHERE user_id=$1 ORDER BY issued_at ASC LIMIT 1',
          [a.id],
        )
      ).rows[0].id;
      const r = await request(app)
        .delete('/auth/sessions/' + initial)
        .set('Authorization', 'Bearer ' + second.body.data.accessToken)
        .set('Cookie', cookies(second))
        .set('X-CSRF-Token', csrf(second));
      expect(r.status).toBe(204);
      await deniedBearer(a.token);
      expect((await account(second.body.data.accessToken)).status).toBe(200);
    });
    it('refresh rotation remains usable but refresh-token reuse revokes its bearer family', async () => {
      const a = await signup('phone');
      const r = await request(app)
        .post('/auth/refresh')
        .set('Cookie', cookies(a.response))
        .set('X-CSRF-Token', csrf(a.response));
      expect(r.status).toBe(200);
      expect((await account(r.body.data.accessToken)).status).toBe(200);
      const replay = await request(app)
        .post('/auth/refresh')
        .set('Cookie', cookies(a.response))
        .set('X-CSRF-Token', csrf(a.response));
      expect(replay.status).toBe(401);
      noCredential(replay);
      await deniedBearer(r.body.data.accessToken);
    });
    it('logout-all and an expired refresh session deny existing bearer access', async () => {
      const a = await signup('email');
      const r = await request(app)
        .post('/auth/logout-all')
        .set('Authorization', 'Bearer ' + a.token)
        .set('Cookie', cookies(a.response))
        .set('X-CSRF-Token', csrf(a.response));
      expect(r.status).toBe(204);
      await deniedBearer(a.token);
      const b = await signup('phone');
      await pool.query(
        "UPDATE refresh_tokens SET issued_at=NOW()-INTERVAL '2 minutes',expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
        [b.id],
      );
      await deniedBearer(b.token);
    });
    it('a correctly signed token cannot borrow another account session family', async () => {
      const a = await signup('phone');
      const b = await signup('email');
      const other = await verifyAccessToken(b.token);
      const token = await new SignJWT({ role: 'driver', type: 'access', sid: other.sid })
        .setSubject(a.id)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
      await deniedBearer(token);
    });
    it('issued bearer claims bind the account selected by the server', async () => {
      const a = await signup('phone');
      const claims = await verifyAccessToken(a.token);
      expect(claims.sub === a.id && claims.role === 'driver' && claims.type === 'access').toBe(
        true,
      );
      expect(typeof claims.sid === 'string').toBe(true);
      const parts = a.token.split('.');
      parts[1] = Buffer.from(
        JSON.stringify({ sub: a.id, role: 'super_admin', type: 'access' }),
      ).toString('base64url');
      await deniedBearer(parts.join('.'));
    });
  },
);
