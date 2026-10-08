import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';
import { Message91OtpProvider } from '../providers/message91-otp.provider.js';
import { FallbackOtpProvider } from '../providers/fallback-otp.provider.js';
import { env } from '../../../config/env.js';
const phone = '+91' + ('8' + randomUUID().replace(/\D/g, '').padEnd(9, '0').slice(0, 9));
const password = 'FixturePassword123!';
let userId: string | undefined;
afterAll(async () => {
  if (userId) {
    for (const table of ['refresh_tokens', 'login_challenges', 'user_credentials'])
      await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  }
  await pool.query('DELETE FROM pending_signups WHERE contact_value=$1', [phone]);
});
describe('MSG91 adapter through existing phone authentication and sessions', () => {
  it('verifies signup/login, rejects invalid OTP and credentials, preserves expiry/CSRF/logout', async () => {
    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const invalid = url.pathname.endsWith('/verify') && url.searchParams.get('otp') !== '123456';
      return new Response(
        JSON.stringify(
          invalid
            ? { type: 'error', message: 'Invalid OTP' }
            : {
                type: 'success',
                message: url.pathname.endsWith('/verify') ? 'OTP verified success' : 'request-id',
              },
        ),
        { status: 200 },
      );
    });
    const adapter = new Message91OtpProvider(
      {
        apiKey: 'fixture-key',
        templateId: 'fixture-template',
        baseUrl: 'https://control.msg91.com/api/v5',
        expiryMinutes: 10,
        timeoutMs: 1000,
      },
      transport,
    );
    const app = createApp(
      new PostgresUserRepository(pool),
      new FallbackOtpProvider(undefined, undefined, { name: 'message91', adapter }),
      { enableAuthRateLimiting: false },
    );
    const signup = await request(app).post('/auth/signup').send({
      firstName: 'MSG91',
      lastName: 'Fixture',
      phone,
      password,
      confirmPassword: password,
      role: 'customer',
    });
    expect(signup.status).toBe(201);
    const signupId = signup.body.data.signupId;
    expect(
      (await pool.query('SELECT otp_provider FROM pending_signups WHERE id=$1', [signupId])).rows[0]
        .otp_provider,
    ).toBe('message91');
    expect(
      (await request(app).post('/auth/signup/verify').send({ signupId, otp: '000000' })).body.error
        .code,
    ).toBe('INVALID_OTP');
    const signed = await request(app).post('/auth/signup/verify').send({ signupId, otp: '123456' });
    expect(signed.status).toBe(200);
    userId = signed.body.data.userId;
    expect(
      (await request(app).post('/auth/login').send({ phone, password: 'WrongPassword123!' }))
        .status,
    ).toBe(401);
    const login = await request(app).post('/auth/login').send({ phone, password });
    expect(login.status).toBe(200);
    const challengeId = login.body.data.challengeId;
    await pool.query(
      "UPDATE login_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [challengeId],
    );
    expect(
      (await request(app).post('/auth/login/verify').send({ challengeId, otp: '123456' })).body
        .error.code,
    ).toBe('OTP_EXPIRED');
    const second = await request(app).post('/auth/login').send({ phone, password });
    expect(second.status).toBe(200);
    const authenticated = await request(app)
      .post('/auth/login/verify')
      .send({ challengeId: second.body.data.challengeId, otp: '123456' });
    expect(authenticated.status).toBe(200);
    const cookies = authenticated.headers['set-cookie'] as unknown as string[];
    const csrf = authenticated.body.data.csrfToken;
    expect(typeof csrf).toBe('string');
    const refresh = await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(refresh.status).toBe(200);
    const rotated = [
      ...(refresh.headers['set-cookie'] as unknown as string[]),
      cookies.find((cookie) => cookie.startsWith(env.AUTH_CSRF_COOKIE_NAME + '='))!,
    ];
    expect(
      (
        await request(app)
          .post('/auth/logout')
          .set('Cookie', rotated)
          .set('X-CSRF-Token', csrf)
          .send({})
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .post('/auth/refresh')
          .set('Cookie', rotated)
          .set('X-CSRF-Token', csrf)
          .send({})
      ).status,
    ).toBe(401);
    expect(transport).toHaveBeenCalled();
  });
});
