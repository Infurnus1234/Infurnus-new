import { randomInt, randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAuthTestRateLimits } from './reset-auth-rate-limits.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { decryptSecret } from '../../../common/crypto/encryption.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import type { OtpProvider } from '../providers/otp.provider.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { GoogleAuthService } from '../services/google-auth.service.js';
import { googleTokenFixture } from './google-token.fixture.js';
import { createUserRouter } from '../../users/routes/user.routes.js';
import { UserController } from '../../users/controllers/user.controller.js';
import { UserService } from '../../users/services/user.service.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';
import { LogoutService } from '../services/logout.service.js';
import { PostgresRefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import { createFleetRouter } from '../../fleet/routes/fleet.routes.js';
import { FleetController } from '../../fleet/controllers/fleet.controller.js';
import { FleetService } from '../../fleet/services/fleet.service.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { env } from '../../../config/env.js';
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

const combinations = [
  ['customer', 'driver'],
  ['customer', 'fleet_owner'],
  ['driver', 'fleet_owner'],
  ['customer', 'driver', 'fleet_owner'],
];
const password = 'Matrix-fixture-pass-2026!';
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Same-contact separate-account role matrix through real registration and login',
  () => {
    const delivery = new AuditOtpDelivery(),
      google = googleTokenFixture(),
      deps = createAuthController(delivery);
    deps.googleAuthService = new GoogleAuthService(google.provider);
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
    app.use(
      '/fleet',
      createFleetRouter(new FleetController(new FleetService(new PostgresFleetRepository(pool)))),
    );
    app.use(errorMiddleware);
    beforeAll(() => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Disposable DB required');
    });
    beforeEach(resetAuthTestRateLimits);
    function contact(kind: string) {
      return kind === 'email'
        ? `matrix-${randomUUID()}@example.test`
        : '+91' + randomInt(6000000000, 9999999999);
    }
    function noCredential(r: request.Response) {
      expect(typeof r.body.data?.accessToken === 'string').toBe(false);
      expect(
        ((r.headers['set-cookie'] ?? []) as unknown as string[]).some((c) =>
          c.startsWith(env.AUTH_REFRESH_COOKIE_NAME + '='),
        ),
      ).toBe(false);
    }
    async function code(id: string, signup = true) {
      const r = await pool.query(
        signup
          ? 'SELECT otp_provider_session_token AS token FROM pending_signups WHERE id=$1'
          : 'SELECT encrypted_provider_session_token AS token FROM login_challenges WHERE id=$1',
        [id],
      );
      return delivery.sessions.get(decryptSecret(r.rows[0].token))!.code;
    }
    async function start(role: string, kind: string, value: string) {
      const r = await request(app)
        .post('/auth/signup')
        .send({
          firstName: 'Matrix',
          lastName: 'Fixture',
          role,
          [kind]: value,
          ...(role === 'driver' ? { onboardingLicencePending: true } : {}),
          ...(role === 'fleet_owner'
            ? { businessName: 'Matrix fixture', password, confirmPassword: password }
            : {}),
        });
      expect(r.status).toBe(201);
      noCredential(r);
      return r.body.data.signupId as string;
    }
    async function finish(id: string) {
      return request(app)
        .post('/auth/signup/verify')
        .send({ signupId: id, otp: await code(id) });
    }
    async function register(role: string, kind: string, value: string) {
      const r = await finish(await start(role, kind, value));
      expect(r.status).toBe(200);
      return r;
    }
    async function login(role: string, kind: string, value: string) {
      const r = await request(app)
        .post('/auth/login')
        .send({ role, [kind]: value, ...(role === 'fleet_owner' ? { password } : {}) });
      expect(r.status).toBe(200);
      noCredential(r);
      const v = await request(app)
        .post('/auth/login/verify')
        .send({
          challengeId: r.body.data.challengeId,
          otp: await code(r.body.data.challengeId, false),
        });
      expect(v.status).toBe(200);
      return v;
    }
    for (const kind of ['email', 'phone'])
      for (const roles of combinations) {
        it(`${kind}: ${roles.join(' + ')} registration, verification, login, profile and authorization stay isolated`, async () => {
          const value = contact(kind),
            accounts = [];
          for (const role of roles) {
            const r = await register(role, kind, value);
            accounts.push({
              role,
              id: r.body.data.userId as string,
              token: r.body.data.accessToken as string,
            });
          }
          expect(new Set(accounts.map((a) => a.id)).size).toBe(roles.length);
          for (const a of accounts) {
            const r = await login(a.role, kind, value);
            expect(r.body.data.userId === a.id).toBe(true);
            const claims = await verifyAccessToken(r.body.data.accessToken);
            expect(
              claims.sub === a.id && claims.role === a.role && typeof claims.sid === 'string',
            ).toBe(true);
            const profile = await request(app)
              .get('/users/' + a.id)
              .set('Authorization', 'Bearer ' + a.token);
            expect(profile.status).toBe(200);
            expect(profile.body.data[kind] === value).toBe(true);
            for (const other of accounts.filter((b) => b.id !== a.id))
              expect(
                (
                  await request(app)
                    .get('/users/' + other.id)
                    .set('Authorization', 'Bearer ' + a.token)
                ).status,
              ).toBe(403);
            expect(
              (
                await request(app)
                  .get('/fleet/revenue')
                  .set('Authorization', 'Bearer ' + a.token)
              ).status,
            ).toBe(a.role === 'fleet_owner' ? 200 : 403);
          }
          const before = delivery.sends;
          const ambiguous = await request(app)
            .post('/auth/login')
            .send({ [kind]: value, password });
          expect(ambiguous.status).toBe(409);
          expect(ambiguous.body.error.code).toBe('ACCOUNT_ROLE_REQUIRED');
          expect(delivery.sends).toBe(before);
        });
      }
    for (const role of ['customer', 'driver', 'fleet_owner'])
      it(`duplicate ${role} registration cannot create another same-role account`, async () => {
        const value = contact('email');
        await register(role, 'email', value);
        const again = await request(app)
          .post('/auth/signup')
          .send({
            firstName: 'Matrix',
            lastName: 'Fixture',
            email: value,
            role,
            ...(role === 'driver' ? { onboardingLicencePending: true } : {}),
            ...(role === 'fleet_owner'
              ? { businessName: 'Matrix fixture', password, confirmPassword: password }
              : {}),
          });
        noCredential(again);
        expect([201, 409].includes(again.status)).toBe(true);
        if (again.status === 201) {
          const failed = await request(app)
            .post('/auth/signup/verify')
            .send({ signupId: again.body.data.signupId, otp: '000000' });
          expect(failed.status).toBe(400);
          noCredential(failed);
        }
        expect(
          (await pool.query('SELECT id FROM users WHERE email=$1 AND role=$2', [value, role]))
            .rowCount,
        ).toBe(1);
      });
    for (const kind of ['email', 'phone'])
      it(`${kind}: concurrent different-role registrations use independent ownership proofs`, async () => {
        const value = contact(kind),
          roles = ['customer', 'driver', 'fleet_owner'];
        const ids = await Promise.all(roles.map((role) => start(role, kind, value)));
        const wrong = await request(app)
          .post('/auth/signup/verify')
          .send({ signupId: ids[1], otp: await code(ids[0]!) });
        expect(wrong.status).toBe(400);
        noCredential(wrong);
        const verified = await Promise.all(ids.map((id) => finish(id)));
        expect(verified.map((r) => r.status)).toEqual([200, 200, 200]);
        expect(new Set(verified.map((r) => r.body.data.userId)).size).toBe(3);
      });
    for (const kind of ['email', 'phone'])
      it(`${kind}: same-contact cross-role login OTP, expiry and replay cannot switch identity`, async () => {
        const value = contact(kind);
        const a = await register('customer', kind, value),
          b = await register('driver', kind, value);
        const ca = await request(app)
            .post('/auth/login')
            .send({ [kind]: value, role: 'customer' }),
          cb = await request(app)
            .post('/auth/login')
            .send({ [kind]: value, role: 'driver' });
        const ac = await code(ca.body.data.challengeId, false),
          bc = await code(cb.body.data.challengeId, false);
        const wrong = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: cb.body.data.challengeId, otp: ac });
        expect(wrong.status).toBe(400);
        noCredential(wrong);
        const ok = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: ca.body.data.challengeId, otp: ac });
        expect(
          ok.body.data.userId === a.body.data.userId && ok.body.data.userId !== b.body.data.userId,
        ).toBe(true);
        expect(
          (
            await request(app)
              .post('/auth/login/verify')
              .send({ challengeId: ca.body.data.challengeId, otp: ac })
          ).status,
        ).toBe(400);
        await pool.query(
          "UPDATE login_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
          [cb.body.data.challengeId],
        );
        const expired = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: cb.body.data.challengeId, otp: bc });
        expect(expired.status).toBe(400);
        noCredential(expired);
      });
    for (const roles of combinations)
      it(`Google verified subject supports ${roles.join(' + ')} without automatic email linking`, async () => {
        const email = contact('email'),
          idToken = await google.token({ sub: randomUUID(), email });
        const ids = [];
        for (const role of roles) {
          const r = await request(app)
            .post('/auth/google')
            .send({
              idToken,
              accountRole: role,
              ...(role === 'customer' ? {} : { driverFlow: 'signup' }),
            });
          expect(r.status).toBe(200);
          ids.push(r.body.data.userId);
          const claims = await verifyAccessToken(r.body.data.accessToken);
          expect(claims.sub === r.body.data.userId && claims.role === role).toBe(true);
        }
        expect(new Set(ids).size).toBe(roles.length);
        expect((await request(app).post('/auth/google').send({ idToken })).status).toBe(409);
      });
    it('logout and refresh reuse revoke only the selected role family, preserving a same-email Fleet account', async () => {
      const email = contact('email'),
        customer = await register('customer', 'email', email),
        fleet = await register('fleet_owner', 'email', email);
      const cookies = (customer.headers['set-cookie'] as unknown as string[]).map(
        (c) => c.split(';')[0]!,
      );
      const csrf = decodeURIComponent(
        cookies
          .find((c) => c.startsWith(env.AUTH_CSRF_COOKIE_NAME + '='))!
          .split('=')
          .slice(1)
          .join('='),
      );
      const refreshed = await request(app)
        .post('/auth/refresh')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf);
      expect(refreshed.status).toBe(200);
      const reused = await request(app)
        .post('/auth/refresh')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf);
      expect(reused.status).toBe(401);
      expect(
        (
          await request(app)
            .get('/users/' + customer.body.data.userId)
            .set('Authorization', 'Bearer ' + refreshed.body.data.accessToken)
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get('/fleet/revenue')
            .set('Authorization', 'Bearer ' + fleet.body.data.accessToken)
        ).status,
      ).toBe(200);
      const fc = (fleet.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!);
      const fcsrf = decodeURIComponent(
        fc
          .find((c) => c.startsWith(env.AUTH_CSRF_COOKIE_NAME + '='))!
          .split('=')
          .slice(1)
          .join('='),
      );
      expect(
        (await request(app).post('/auth/logout').set('Cookie', fc).set('X-CSRF-Token', fcsrf))
          .status,
      ).toBe(204);
      expect(
        (
          await request(app)
            .get('/fleet/revenue')
            .set('Authorization', 'Bearer ' + fleet.body.data.accessToken)
        ).status,
      ).toBe(401);
    });
  },
);
