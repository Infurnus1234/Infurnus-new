import { verifyAccessToken } from '../utils/jwt.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { createApp } from '../../../app.js';
import { env } from '../../../config/env.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';
import { PostgresLoginChallengeRepository } from '../repositories/login-challenge.repository.js';
import { PostgresPendingSignupRepository } from '../repositories/pending-signup.repository.js';
import type { OtpProvider } from '../providers/otp.provider.js';

const users: string[] = [],
  signups: string[] = [];
afterAll(async () => {
  for (const id of users) {
    await pool.query('DELETE FROM provider_approval_requests WHERE requester_id=$1', [id]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM login_challenges WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM user_credentials WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM driver_profiles WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM provider_onboarding WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
  }
  for (const id of signups) await pool.query('DELETE FROM pending_signups WHERE id=$1', [id]);
});
function fixture() {
  const send = vi.fn(async () => ({
    sessionId: randomUUID(),
    sessionToken: randomUUID(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  }));
  const verify = vi.fn(async (_token: string, otp: string) => ({
    verified: otp === '123456',
    attemptsRemaining: null,
  }));
  const provider: OtpProvider = {
    sendSmsOtp: send,
    sendEmailOtp: send,
    verifySmsOtp: verify,
    verifyEmailOtp: verify,
    resendSmsOtp: vi.fn(),
    resendEmailOtp: vi.fn(),
  };
  const app = createApp(new PostgresUserRepository(pool), provider, {
    enableAuthRateLimiting: false,
  });
  return { app, verify };
}
describe('provider-independent OTP attempt budgets and passwordless identities', () => {
  it.each(['email', 'phone'])(
    'default application fails closed without configured %s delivery',
    async (channel) => {
      const original = {
        config: env.OTP_PROVIDER_CONFIG,
        resend: env.RESEND_API_KEY,
        key: env.MSG91_AUTH_KEY,
        template: env.MSG91_TEMPLATE_ID,
      };
      env.OTP_PROVIDER_CONFIG = undefined;
      env.RESEND_API_KEY = undefined;
      env.MSG91_AUTH_KEY = undefined;
      env.MSG91_TEMPLATE_ID = undefined;
      try {
        const contact =
          channel === 'email'
            ? `default-${randomUUID()}@example.com`
            : '+91' + randomUUID().replace(/\D/g, '').padEnd(10, '1').slice(0, 10);
        const app = createApp(new PostgresUserRepository(pool));
        const response = await request(app)
          .post('/auth/signup')
          .send({
            firstName: 'Default',
            lastName: 'Delivery',
            role: 'customer',
            [channel]: contact,
          });
        if (response.body.data?.signupId) signups.push(response.body.data.signupId);
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('OTP_PROVIDER_NOT_CONFIGURED');
        expect(
          (await pool.query('SELECT 1 FROM pending_signups WHERE contact_value=$1', [contact]))
            .rowCount,
        ).toBe(0);
      } finally {
        env.OTP_PROVIDER_CONFIG = original.config;
        env.RESEND_API_KEY = original.resend;
        env.MSG91_AUTH_KEY = original.key;
        env.MSG91_TEMPLATE_ID = original.template;
      }
    },
  );
  for (const role of ['customer', 'driver'] as const)
    for (const channel of ['email', 'phone'] as const) {
      it(`${role} ${channel}: signup/login, cooldown, attempt exhaustion, single-use and account identity`, async () => {
        const { app, verify } = fixture();
        const contact =
          channel === 'email'
            ? `bounded-${randomUUID()}@example.com`
            : '+91' + randomUUID().replace(/\D/g, '').padEnd(10, '1').slice(0, 10);
        const data = {
          firstName: 'Bounded',
          lastName: 'Fixture',
          [channel]: contact,
          role,
          ...(role === 'driver'
            ? { licenseNumber: 'BOUND-' + randomUUID().slice(0, 16), licenseExpiry: '2099-12-31' }
            : {}),
        };
        const signup = await request(app).post('/auth/signup').send(data).expect(201);
        const signupId = signup.body.data.signupId;
        signups.push(signupId);
        expect(signup.body.data.accessToken).toBeUndefined();
        expect(signup.headers['set-cookie']).toBeUndefined();
        expect(
          (
            await pool.query(
              `SELECT 1 FROM users WHERE ${channel === 'email' ? 'email' : 'phone'}=$1`,
              [contact],
            )
          ).rowCount,
        ).toBe(0);
        await request(app).post('/auth/signup/resend').send({ signupId }).expect(429);
        await request(app)
          .post('/auth/signup/verify')
          .send({ signupId, otp: '000000' })
          .expect(400);
        const created = await request(app)
          .post('/auth/signup/verify')
          .send({ signupId, otp: '123456' })
          .expect(200);
        const id = created.body.data.userId;
        users.push(id);
        expect((await verifyAccessToken(created.body.data.accessToken)).role).toBe(role);
        await request(app)
          .post('/auth/signup/verify')
          .send({ signupId, otp: '123456' })
          .expect(400);
        const login = await request(app)
          .post('/auth/login')
          .send({ [channel]: contact })
          .expect(200);
        const challengeId = login.body.data.challengeId;
        expect(login.body.data.accessToken).toBeUndefined();
        expect(login.headers['set-cookie']).toBeUndefined();
        await request(app).post('/auth/login/resend').send({ challengeId }).expect(429);
        const before = verify.mock.calls.length;
        for (let i = 0; i < env.AUTH_OTP_MAX_ATTEMPTS; i++)
          await request(app)
            .post('/auth/login/verify')
            .send({ challengeId, otp: '000000' })
            .expect(400);
        const denied = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId, otp: '123456' })
          .expect(429);
        expect(denied.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
        expect(verify.mock.calls.length - before).toBe(env.AUTH_OTP_MAX_ATTEMPTS);
        await pool.query(
          "UPDATE login_challenges SET last_otp_sent_at=NOW()-INTERVAL '2 minutes' WHERE id=$1",
          [challengeId],
        );
        expect(
          await new PostgresLoginChallengeRepository(pool).claimResend(challengeId, 60),
        ).toBeNull();
        await pool.query(
          "UPDATE login_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
          [challengeId],
        );
        const fresh = await request(app)
          .post('/auth/login')
          .send({ [channel]: contact })
          .expect(200);
        const authenticated = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: fresh.body.data.challengeId, otp: '123456' })
          .expect(200);
        expect(authenticated.body.data.userId).toBe(id);
        expect(authenticated.body.data.accessToken).toEqual(expect.any(String));
        await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: fresh.body.data.challengeId, otp: '123456' })
          .expect(400);
        if (role === 'driver')
          expect(
            (
              await pool.query('SELECT verification_status FROM driver_profiles WHERE user_id=$1', [
                id,
              ])
            ).rows[0].verification_status,
          ).toBe('pending');
      });
    }
  it('atomically limits concurrent login and signup verification reservations', async () => {
    const { app } = fixture();
    const email = `concurrent-${randomUUID()}@example.com`;
    const signup = await request(app)
      .post('/auth/signup')
      .send({ firstName: 'Concurrent', lastName: 'Proof', email, role: 'customer' })
      .expect(201);
    const signupId = signup.body.data.signupId;
    signups.push(signupId);
    const pending = new PostgresPendingSignupRepository();
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => pending.claimVerificationAttempt(signupId, 3)),
    );
    expect(claims.filter(Boolean)).toHaveLength(3);
    await request(app).post('/auth/signup/verify').send({ signupId, otp: '123456' }).expect(200);
    const id = (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
    users.push(id);
    const login = await request(app).post('/auth/login').send({ email }).expect(200);
    const challenges = new PostgresLoginChallengeRepository(pool);
    const logins = await Promise.all(
      Array.from({ length: 12 }, () =>
        challenges.claimVerificationAttempt(login.body.data.challengeId, 3),
      ),
    );
    expect(logins.filter(Boolean)).toHaveLength(3);
  });
  it('does not reserve resend delivery for exhausted or expired pending signups', async () => {
    const { app } = fixture();
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Resend',
        lastName: 'Boundary',
        email: `resend-${randomUUID()}@example.com`,
        role: 'customer',
      })
      .expect(201);
    const signupId = signup.body.data.signupId;
    signups.push(signupId);
    const repository = new PostgresPendingSignupRepository();
    await pool.query(
      "UPDATE pending_signups SET otp_attempts=$2,last_otp_sent_at=NOW()-INTERVAL '2 minutes' WHERE id=$1",
      [signupId, env.AUTH_OTP_MAX_ATTEMPTS],
    );
    expect(await repository.claimOtpResend(signupId, 60)).toBeNull();
    await pool.query(
      "UPDATE pending_signups SET otp_attempts=0,otp_provider_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [signupId],
    );
    expect(await repository.claimOtpResend(signupId, 60)).toBeNull();
  });
  it('allows a new registration attempt after an unverified pending signup expires', async () => {
    const { app } = fixture();
    const payload = {
      firstName: 'Expired',
      lastName: 'Registration',
      email: `expired-${randomUUID()}@example.com`,
      role: 'customer',
    };
    const initial = await request(app).post('/auth/signup').send(payload).expect(201);
    signups.push(initial.body.data.signupId);
    await pool.query(
      'UPDATE pending_signups SET otp_provider_expires_at=$2 WHERE id=$1',
      // Expire against the application clock too; Docker and host clocks can differ.
      [initial.body.data.signupId, new Date(Date.now() - 60_000)],
    );
    const next = await request(app).post('/auth/signup').send(payload).expect(201);
    signups.push(next.body.data.signupId);
    expect(next.body.data.signupId).not.toBe(initial.body.data.signupId);
    expect(
      (await pool.query('SELECT 1 FROM pending_signups WHERE id=$1', [next.body.data.signupId]))
        .rowCount,
    ).toBe(1);
    await request(app)
      .post('/auth/signup/verify')
      .send({ signupId: initial.body.data.signupId, otp: '123456' })
      .expect(400);
  });
  it.each(['customer', 'driver'])(
    '%s treats the optional phone plus prefix as the same identity',
    async (role) => {
      const { app } = fixture();
      const phone = '+91' + randomUUID().replace(/\D/g, '').padEnd(10, '1').slice(0, 10);
      const payload = {
        firstName: 'Phone',
        lastName: 'Identity',
        phone,
        role,
        ...(role === 'driver'
          ? { licenseNumber: 'PHONE-' + randomUUID().slice(0, 16), licenseExpiry: '2099-12-31' }
          : {}),
      };
      const initial = await request(app).post('/auth/signup').send(payload).expect(201);
      signups.push(initial.body.data.signupId);
      const created = await request(app)
        .post('/auth/signup/verify')
        .send({ signupId: initial.body.data.signupId, otp: '123456' })
        .expect(200);
      users.push(created.body.data.userId);
      const duplicateUserId = randomUUID();
      users.push(duplicateUserId);
      await expect(
        pool.query(
          "INSERT INTO users(id,first_name,last_name,phone,role,phone_verified) VALUES($1,'Collision','Fixture',$2,$3,TRUE)",
          [duplicateUserId, phone.slice(1), role],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      const duplicate = await request(app)
        .post('/auth/signup')
        .send({ ...payload, phone: phone.slice(1) })
        .expect(201);
      signups.push(duplicate.body.data.signupId);
      expect(
        (
          await pool.query('SELECT 1 FROM pending_signups WHERE id=$1', [
            duplicate.body.data.signupId,
          ])
        ).rowCount,
      ).toBe(0);
      const login = await request(app)
        .post('/auth/login')
        .send({ phone: phone.slice(1) })
        .expect(200);
      const authenticated = await request(app)
        .post('/auth/login/verify')
        .send({ challengeId: login.body.data.challengeId, otp: '123456' })
        .expect(200);
      expect(authenticated.body.data.userId).toBe(created.body.data.userId);
    },
  );
  it('enforces the same phone alias uniqueness for pending registration races', async () => {
    const { app } = fixture();
    const phone = '+91' + randomUUID().replace(/\D/g, '').padEnd(10, '1').slice(0, 10);
    const initial = await request(app)
      .post('/auth/signup')
      .send({ firstName: 'Pending', lastName: 'Phone', phone, role: 'customer' })
      .expect(201);
    signups.push(initial.body.data.signupId);
    await expect(
      new PostgresPendingSignupRepository().create({
        firstName: 'Alias',
        lastName: 'Race',
        email: null,
        contactType: 'phone',
        contactValue: phone.slice(1),
        passwordHash: 'unusable-fixture',
        role: 'customer',
        licenseNumber: null,
        licenseExpiry: null,
        businessName: null,
        otpProvider: 'external',
        otpProviderSessionId: randomUUID(),
        otpProviderSessionToken: 'encrypted-fixture',
        otpProviderExpiresAt: new Date(Date.now() + 60000),
      }),
    ).rejects.toMatchObject({ code: 'SIGNUP_ALREADY_PENDING' });
  });
});
