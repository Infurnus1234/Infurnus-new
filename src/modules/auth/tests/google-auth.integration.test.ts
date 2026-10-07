import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { env } from '../../../config/env.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { GoogleAuthService } from '../services/google-auth.service.js';
import { PostgresGoogleIdentityRepository } from '../repositories/google-identity.repository.js';
import { signAccessToken, verifyAccessToken } from '../utils/jwt.js';
import { googleTokenFixture } from './google-token.fixture.js';

// Only the Google certificate source is mocked. Official signature/claims validation,
// PostgreSQL account mapping, JWT/session/cookie/CSRF handlers run unchanged.
describe('Google auth actual backend and PostgreSQL (fixture Google signing key)', () => {
  const fixture = googleTokenFixture();
  const repository = new PostgresGoogleIdentityRepository();
  let prefix: string;
  let app: ReturnType<typeof express>;
  let idToken: string;
  let email: string;
  let subject: string;
  beforeEach(async () => {
    prefix = 'google-auth-' + randomUUID();
    email = prefix + '@example.com';
    subject = prefix;
    idToken = await fixture.token({ sub: subject, email });
    const deps = createAuthController();
    deps.googleAuthService = new GoogleAuthService(fixture.provider, repository);
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', createAuthRouter(deps, { enableRateLimiting: false }));
    app.use(errorMiddleware);
  });
  afterEach(async () => {
    await pool.query(
      'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
      [prefix + '%'],
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', [prefix + '%']);
  });
  async function user(role = 'customer', status = 'active') {
    const result = await pool.query(
      "INSERT INTO users(first_name,last_name,email,role,status) VALUES('Google','Fixture',$1,$2,$3) RETURNING id",
      [email, role, status],
    );
    return result.rows[0].id as string;
  }
  async function link(id: string) {
    const csrf = 'fixture-csrf';
    return request(app)
      .post('/auth/google/link')
      .set(
        'Authorization',
        'Bearer ' + (await signAccessToken({ sub: id, role: 'customer', type: 'access' })),
      )
      .set('Cookie', env.AUTH_CSRF_COOKIE_NAME + '=' + csrf)
      .set('X-CSRF-Token', csrf)
      .send({ idToken });
  }
  it('creates one customer, issues existing JWT/refresh cookies, rotates and logs out', async () => {
    const response = await request(app).post('/auth/google').send({ idToken });
    expect(response.status).toBe(200);
    const payload = await verifyAccessToken(response.body.data.accessToken);
    expect(payload).toMatchObject({
      sub: response.body.data.userId,
      role: 'customer',
      type: 'access',
    });
    const again = await request(app).post('/auth/google').send({ idToken });
    expect(again.body.data.userId).toBe(payload.sub);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const csrf = cookies
      .find((v) => v.startsWith(env.AUTH_CSRF_COOKIE_NAME + '='))!
      .split(';')[0]!
      .split('=')[1]!;
    expect(cookies.find((v) => v.startsWith(env.AUTH_REFRESH_COOKIE_NAME + '='))).toContain(
      'HttpOnly',
    );
    const refreshed = await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(refreshed.status).toBe(200);
    expect((await verifyAccessToken(refreshed.body.data.accessToken)).role).toBe('customer');
    const rotated = [
      ...(refreshed.headers['set-cookie'] as unknown as string[]),
      cookies.find((v) => v.startsWith(env.AUTH_CSRF_COOKIE_NAME + '='))!,
    ];
    const rotatedCsrf = csrf;
    expect(
      (
        await request(app)
          .post('/auth/logout')
          .set('Cookie', rotated)
          .set('X-CSRF-Token', rotatedCsrf)
          .send({})
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .post('/auth/refresh')
          .set('Cookie', rotated)
          .set('X-CSRF-Token', rotatedCsrf)
          .send({})
      ).status,
    ).toBe(401);
    const stored = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id=$1', [
      payload.sub,
    ]);
    expect(stored.rows.length).toBeGreaterThan(0);
    expect(stored.rows.every((r) => !cookies.some((c) => c.includes(r.token_hash)))).toBe(true);
  });
  it.each(['customer', 'driver', 'fleet_owner', 'driver_fleet_owner', 'admin', 'super_admin'])(
    'preserves DB role %s through explicit linking',
    async (role) => {
      const id = await user(role);
      expect((await request(app).post('/auth/google').send({ idToken })).status).toBe(409);
      expect((await link(id)).status).toBe(200);
      const response = await request(app).post('/auth/google').send({ idToken });
      expect(response.status).toBe(200);
      expect(await verifyAccessToken(response.body.data.accessToken)).toMatchObject({
        sub: id,
        role,
      });
    },
  );
  it.each(['suspended', 'banned'])('rejects %s linked account without sessions', async (status) => {
    const id = await user('customer', status);
    await pool.query(
      "INSERT INTO auth_external_identities(provider,provider_subject,user_id) VALUES('GOOGLE',$1,$2)",
      [subject, id],
    );
    expect((await request(app).post('/auth/google').send({ idToken })).status).toBe(401);
    expect(
      (await pool.query('SELECT id FROM refresh_tokens WHERE user_id=$1', [id])).rowCount,
    ).toBe(0);
  });
  it('rejects soft-deleted linked account instead of creating another', async () => {
    const id = await user();
    await pool.query(
      "INSERT INTO auth_external_identities(provider,provider_subject,user_id) VALUES('GOOGLE',$1,$2)",
      [subject, id],
    );
    await pool.query('UPDATE users SET deleted_at=NOW() WHERE id=$1', [id]);
    expect((await request(app).post('/auth/google').send({ idToken })).status).toBe(401);
  });
  it('requires authentication and CSRF for explicit linking', async () => {
    expect((await request(app).post('/auth/google/link').send({ idToken })).status).toBe(401);
    const id = await user();
    const access = await signAccessToken({ sub: id, role: 'customer', type: 'access' });
    expect(
      (
        await request(app)
          .post('/auth/google/link')
          .set('Authorization', 'Bearer ' + access)
          .send({ idToken })
      ).status,
    ).toBe(403);
  });
  it('rejects mismatched account email and another subject for the same user', async () => {
    const id = await user();
    expect((await link(id)).status).toBe(200);
    idToken = await fixture.token({ sub: subject + '-other', email });
    expect((await link(id)).status).toBe(409);
    idToken = await fixture.token({
      sub: subject + '-different',
      email: prefix + 'different@example.com',
    });
    expect((await link(id)).status).toBe(409);
  });
  it('serializes parallel requests without duplicate accounts or links', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(app).post('/auth/google').send({ idToken })),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(new Set(responses.map((r) => r.body.data.userId)).size).toBe(1);
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(1);
  });
  it.each([
    {},
    { idToken: 'malformed' },
    { idToken: 'a.b.c', role: 'admin' },
    { idToken: 'a.b.c', userId: 'forged' },
  ])('rejects missing/malformed/privilege-injecting input %j', async (body) => {
    expect((await request(app).post('/auth/google').send(body)).status).toBe(400);
  });
  it('rejects incomplete new-account profile without writing a user', async () => {
    idToken = await fixture.token({ sub: subject, email, family_name: undefined });
    expect((await request(app).post('/auth/google').send({ idToken })).status).toBe(409);
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(0);
  });
  it('ignores signed external role claims and keeps new accounts customer', async () => {
    idToken = await fixture.token({ sub: subject, email, role: 'super_admin' });
    const response = await request(app).post('/auth/google').send({ idToken });
    expect(response.status).toBe(200);
    expect((await verifyAccessToken(response.body.data.accessToken)).role).toBe('customer');
  });
  it('maps a linked subject even when Google email changes without altering local profile', async () => {
    const initial = await request(app).post('/auth/google').send({ idToken });
    idToken = await fixture.token({ sub: subject, email: prefix + 'changed@example.com' });
    const response = await request(app).post('/auth/google').send({ idToken });
    expect(response.body.data.userId).toBe(initial.body.data.userId);
    expect(
      (await pool.query('SELECT email FROM users WHERE id=$1', [response.body.data.userId])).rows[0]
        .email,
    ).toBe(email);
  });
  it('rejects concurrent different subjects sharing an existing email', async () => {
    const other = await fixture.token({ sub: subject + 'other', email });
    const responses = await Promise.all(
      [idToken, other].map((token) => request(app).post('/auth/google').send({ idToken: token })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(1);
  });
  it('sanitizes database failure and does not issue cookies', async () => {
    const fail = vi
      .spyOn(repository, 'resolve')
      .mockRejectedValueOnce(new Error('database internals'));
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app).post('/auth/google').send({ idToken });
      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally {
      fail.mockRestore();
      logging.mockRestore();
    }
  });
  it('returns sanitized provider failure without sessions', async () => {
    vi.mocked(fixture.client.getFederatedSignonCertsAsync).mockRejectedValueOnce(
      new Error('network internals'),
    );
    const response = await request(app).post('/auth/google').send({ idToken });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('GOOGLE_AUTH_UNAVAILABLE');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
