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
        await request(app).post('/auth/signup/resend').send({ signupId }).expect(429);
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
});
