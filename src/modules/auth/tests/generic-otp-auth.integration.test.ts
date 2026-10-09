import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { env } from '../../../config/env.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';
import { createConfiguredOtpProvider } from '../providers/otp-provider.factory.js';
import type { HttpOtpProfile } from '../providers/generic-http-otp.provider.js';

const original = { ...env };
const users: string[] = [],
  contacts: string[] = [];
afterEach(async () => {
  Object.assign(env, original);
  env.OTP_PROVIDER_CONFIG = original.OTP_PROVIDER_CONFIG;
  vi.unstubAllGlobals();
  for (const id of users.splice(0)) {
    for (const table of ['refresh_tokens', 'login_challenges', 'user_credentials'])
      await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [id]);
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
  }
  for (const value of contacts.splice(0))
    await pool.query('DELETE FROM pending_signups WHERE contact_value=$1', [value]);
});
const profile = (id: string): HttpOtpProfile => ({
  id,
  operations: {
    send: {
      url: 'https://otp.example/send',
      method: 'POST',
      body: { recipient: '{{recipient}}' },
      success: [{ path: 'accepted', equals: true }],
    },
    verify: {
      url: 'https://otp.example/verify',
      method: 'POST',
      body: { code: '{{otp}}', token: '{{sessionToken}}' },
      success: [{ path: 'verified', equals: true }],
      invalid: [{ path: 'verified', equals: false }],
    },
    resend: {
      url: 'https://otp.example/resend',
      method: 'POST',
      body: { token: '{{sessionToken}}' },
      success: [{ path: 'accepted', equals: true }],
    },
  },
  response: { sessionTokenPath: 'token', ttlSeconds: 600, attemptsPath: 'attempts' },
});

describe('same auth API across generic configuration A and B', () => {
  for (const configuration of ['configurationA', 'configurationB']) {
    it(`${configuration}: email and SMS signup, invalid/expired codes, resend, login and logout`, async () => {
      env.OTP_PROVIDER_CONFIG = JSON.stringify({
        email: profile(configuration),
        sms: profile(configuration),
      });
      env.RESEND_API_KEY = undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (input, init) => {
          const url = new URL(String(input)),
            body = JSON.parse(String(init?.body ?? '{}'));
          return new Response(
            JSON.stringify(
              url.pathname.endsWith('/verify')
                ? { verified: body.code === '123456', attempts: 3 }
                : { accepted: true, token: 'opaque-fixture-session' },
            ),
          );
        }),
      );
      const app = createApp(new PostgresUserRepository(pool), createConfiguredOtpProvider(pool), {
        enableAuthRateLimiting: false,
      });
      for (const channel of ['email', 'phone']) {
        const contact =
          channel === 'email'
            ? `generic-${randomUUID()}@example.com`
            : '+91' + ('8' + randomUUID().replace(/\D/g, '').padEnd(9, '0').slice(0, 9));
        contacts.push(contact);
        const password = 'FixturePassword123!';
        const signed = await request(app)
          .post('/auth/signup')
          .send({
            firstName: 'Generic',
            lastName: 'Fixture',
            [channel]: contact,
            password,
            confirmPassword: password,
            role: 'customer',
          });
        expect(signed.status).toBe(201);
        const signupId = signed.body.data.signupId;
        expect(
          (await request(app).post('/auth/signup/verify').send({ signupId, otp: '000000' })).body
            .error.code,
        ).toBe('INVALID_OTP');
        expect((await request(app).post('/auth/signup/resend').send({ signupId })).status).toBe(
          429,
        );
        await pool.query(
          "UPDATE pending_signups SET last_otp_sent_at=NOW()-INTERVAL '2 minutes' WHERE id=$1",
          [signupId],
        );
        expect((await request(app).post('/auth/signup/resend').send({ signupId })).status).toBe(
          200,
        );
        const verified = await request(app)
          .post('/auth/signup/verify')
          .send({ signupId, otp: '123456' });
        expect(verified.status).toBe(200);
        users.push(verified.body.data.userId);
        const login = await request(app)
          .post('/auth/login')
          .send({ [channel]: contact, password });
        expect(login.status).toBe(200);
        const expired = await pool.query<{ unconsumed: boolean; unverified: boolean }>(
          "UPDATE login_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1 RETURNING consumed_at IS NULL AS unconsumed, verified_at IS NULL AS unverified",
          [login.body.data.challengeId],
        );
        expect(expired.rows).toEqual([{ unconsumed: true, unverified: true }]);
        expect(
          (
            await request(app)
              .post('/auth/login/verify')
              .send({ challengeId: login.body.data.challengeId, otp: '123456' })
          ).body.error.code,
        ).toBe('OTP_EXPIRED');
        const fresh = await request(app)
          .post('/auth/login')
          .send({ [channel]: contact, password });
        const authenticated = await request(app)
          .post('/auth/login/verify')
          .send({ challengeId: fresh.body.data.challengeId, otp: '123456' });
        expect(authenticated.status).toBe(200);
        expect(typeof authenticated.body.data.accessToken).toBe('string');
        const cookies = authenticated.headers['set-cookie'] as unknown as string[];
        expect(
          (
            await request(app)
              .post('/auth/logout')
              .set('Cookie', cookies)
              .set('X-CSRF-Token', authenticated.body.data.csrfToken)
              .send({})
          ).status,
        ).toBe(204);
      }
    });
  }
});
