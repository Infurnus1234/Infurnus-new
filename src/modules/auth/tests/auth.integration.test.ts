import { randomUUID } from 'node:crypto';

import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../../app.js';
import { env } from '../../../config/env.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';

import type { OtpProvider } from '../providers/otp.provider.js';
import { hashRefreshToken } from '../utils/refresh-token.js';

class TestOtpProvider implements OtpProvider {
  private readonly otps = new Map<string, string>();

  async sendEmailOtp(email: string, otp: string): Promise<void> {
    this.otps.set(`email:${email}`, otp);
  }

  async sendSmsOtp(phone: string, otp: string): Promise<void> {
    this.otps.set(`phone:${phone}`, otp);
  }

  getEmailOtp(email: string): string {
    const otp = this.otps.get(`email:${email}`);

    if (!otp) {
      throw new Error('Test OTP was not captured for email');
    }

    return otp;
  }

  getSmsOtp(phone: string): string {
    const otp = this.otps.get(`phone:${phone}`);

    if (!otp) {
      throw new Error('Test OTP was not captured for phone');
    }

    return otp;
  }

  clear(): void {
    this.otps.clear();
  }
}

function getSetCookieHeaders(response: Response): string[] {
  const setCookieHeader = response.headers['set-cookie'];

  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader;
  }

  if (typeof setCookieHeader === 'string') {
    return [setCookieHeader];
  }

  return [];
}

function getRefreshCookie(response: Response): string {
  const cookies = getSetCookieHeaders(response);

  const prefix = `${env.AUTH_REFRESH_COOKIE_NAME}=`;

  const refreshCookie = cookies.find((cookie: string) => cookie.startsWith(prefix));

  if (!refreshCookie) {
    throw new Error(`Refresh token cookie "${env.AUTH_REFRESH_COOKIE_NAME}" was not found`);
  }

  return refreshCookie.split(';', 1)[0];
}

function getRefreshTokenFromCookie(cookie: string): string {
  const prefix = `${env.AUTH_REFRESH_COOKIE_NAME}=`;

  if (!cookie.startsWith(prefix)) {
    throw new Error('Invalid refresh cookie');
  }

  const encodedToken = cookie.slice(prefix.length);

  if (!encodedToken) {
    throw new Error('Refresh token cookie is empty');
  }

  return decodeURIComponent(encodedToken);
}

function expectRefreshCookie(response: Response): string {
  const cookie = getRefreshCookie(response);

  expect(cookie).toMatch(new RegExp(`^${env.AUTH_REFRESH_COOKIE_NAME}=.+$`));

  return cookie;
}

describe.sequential('Auth integration', () => {
  const otpProvider = new TestOtpProvider();

  const app = createApp(new PostgresUserRepository(pool), otpProvider, {
    enableAuthRateLimiting: false,
  });

  let email: string;

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  // ==========================================================
  // Existing full Auth integration flow
  // ==========================================================

  it('completes signup, login, refresh rotation, and logout against PostgreSQL', async () => {
    email = `auth-integration-${randomUUID()}@example.com`;

    // ======================================================
    // 1. Signup
    // ======================================================

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Integration',
        lastName: 'Test',
        email,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
        role: 'customer',
      })
      .expect(201);

    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    expect(signupId).toEqual(expect.any(String));

    expect(signupResponse.body.data.contactType).toBe('email');

    expect(signupResponse.body.data.expiresAt).toBeDefined();

    expect(signupResponse.body.data.otp).toBeUndefined();

    // ======================================================
    // 2. Verify pending signup exists
    // ======================================================

    const pendingResult = await pool.query(
      `
        SELECT
          id,
          contact_value AS "contactValue"
        FROM pending_signups
        WHERE id = $1
      `,
      [signupId],
    );

    expect(pendingResult.rows).toHaveLength(1);

    expect(pendingResult.rows[0].contactValue).toBe(email);

    // ======================================================
    // 3. Retrieve OTP from test-only provider
    // ======================================================

    const otp = otpProvider.getEmailOtp(email);

    expect(otp).toMatch(/^\d{6}$/);

    // ======================================================
    // 4. Verify signup
    // ======================================================

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    expect(verifyResponse.body.success).toBe(true);

    const { userId, accessToken } = verifyResponse.body.data;

    expect(userId).toEqual(expect.any(String));

    expect(accessToken).toEqual(expect.any(String));

    expect(verifyResponse.body.data.refreshToken).toBeUndefined();

    const verifyRefreshCookie = expectRefreshCookie(verifyResponse);

    // ======================================================
    // 5. Pending signup must be deleted
    // ======================================================

    const pendingAfterVerification = await pool.query(
      `
        SELECT id
        FROM pending_signups
        WHERE id = $1
      `,
      [signupId],
    );

    expect(pendingAfterVerification.rows).toHaveLength(0);

    // ======================================================
    // 6. User must be created correctly
    // ======================================================

    const userResult = await pool.query(
      `
        SELECT
          id,
          first_name,
          last_name,
          email,
          phone,
          email_verified,
          phone_verified,
          role,
          status
        FROM users
        WHERE id = $1
      `,
      [userId],
    );

    expect(userResult.rows).toHaveLength(1);

    expect(userResult.rows[0]).toMatchObject({
      id: userId,
      first_name: 'Integration',
      last_name: 'Test',
      email,
      phone: null,
      email_verified: true,
      phone_verified: false,
      role: 'customer',
      status: 'active',
    });

    // ======================================================
    // 7. Credentials must be created
    // ======================================================

    const credentialsResult = await pool.query(
      `
        SELECT
          user_id,
          password_hash
        FROM user_credentials
        WHERE user_id = $1
      `,
      [userId],
    );

    expect(credentialsResult.rows).toHaveLength(1);

    expect(credentialsResult.rows[0].user_id).toBe(userId);

    expect(credentialsResult.rows[0].password_hash).toMatch(/^\$argon2/);

    // ======================================================
    // 8. Login with the new account
    // ======================================================

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({
        email,
        password: 'TestPassword123!',
      })
      .expect(200);

    expect(loginResponse.body.success).toBe(true);

    expect(loginResponse.body.data.userId).toBe(userId);

    expect(loginResponse.body.data.accessToken).toEqual(expect.any(String));

    expect(loginResponse.body.data.refreshToken).toBeUndefined();

    const loginRefreshCookie = expectRefreshCookie(loginResponse);

    expect(loginRefreshCookie).not.toBe(verifyRefreshCookie);

    // ======================================================
    // 9. Refresh token rotation
    // ======================================================

    const refreshResponse = await request(app)
      .post('/auth/refresh')
      .set('Cookie', loginRefreshCookie)
      .expect(200);

    expect(refreshResponse.body.success).toBe(true);

    expect(refreshResponse.body.data.accessToken).toEqual(expect.any(String));

    expect(refreshResponse.body.data.refreshToken).toBeUndefined();

    const rotatedRefreshCookie = expectRefreshCookie(refreshResponse);

    expect(rotatedRefreshCookie).not.toBe(loginRefreshCookie);

    // ======================================================
    // 10. Logout
    // ======================================================

    const logoutResponse = await request(app)
      .post('/auth/logout')
      .set('Cookie', rotatedRefreshCookie)
      .expect(204);

    const logoutSetCookies = getSetCookieHeaders(logoutResponse);

    expect(logoutSetCookies.length).toBeGreaterThan(0);

    const clearedRefreshCookie = logoutSetCookies.find((cookie: string) =>
      cookie.startsWith(`${env.AUTH_REFRESH_COOKIE_NAME}=`),
    );

    expect(clearedRefreshCookie).toBeDefined();

    expect(clearedRefreshCookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');

    // ======================================================
    // 11. Revoked refresh token must fail
    // ======================================================

    await request(app).post('/auth/refresh').set('Cookie', rotatedRefreshCookie).expect(401);
  });

  // ==========================================================
  // Task #11
  // Duplicate signup race-condition hardening
  // ==========================================================

  it('allows only one concurrent signup for the same contact', async () => {
    const raceEmail = `auth-race-${randomUUID()}@example.com`;

    const signupPayload = {
      firstName: 'Race',
      lastName: 'Test',
      email: raceEmail,
      password: 'TestPassword123!',
      confirmPassword: 'TestPassword123!',
      role: 'customer',
    };

    const [responseA, responseB] = await Promise.all([
      request(app).post('/auth/signup').send(signupPayload),
      request(app).post('/auth/signup').send(signupPayload),
    ]);

    const statuses = [responseA.status, responseB.status].sort((a, b) => a - b);

    expect(statuses).toEqual([201, 409]);

    const successfulResponse = responseA.status === 201 ? responseA : responseB;

    const rejectedResponse = responseA.status === 409 ? responseA : responseB;

    expect(successfulResponse.body.success).toBe(true);

    expect(successfulResponse.body.data.signupId).toEqual(expect.any(String));

    expect(successfulResponse.body.data.contactType).toBe('email');

    expect(successfulResponse.body.data.otp).toBeUndefined();

    expect(rejectedResponse.body.success).toBe(false);

    expect(rejectedResponse.body.error.code).toBe('SIGNUP_ALREADY_PENDING');

    expect(rejectedResponse.body.error.message).toBe(
      'A signup is already pending for this contact',
    );

    const pendingResult = await pool.query(
      `
        SELECT
          id,
          contact_type,
          contact_value
        FROM pending_signups
        WHERE contact_type = 'email'
          AND contact_value = $1
      `,
      [raceEmail],
    );

    expect(pendingResult.rows).toHaveLength(1);

    expect(pendingResult.rows[0].contact_type).toBe('email');

    expect(pendingResult.rows[0].contact_value).toBe(raceEmail);

    await pool.query(
      `
        DELETE FROM pending_signups
        WHERE contact_type = 'email'
          AND contact_value = $1
      `,
      [raceEmail],
    );
  });

  // ==========================================================
  // Task #12
  // OTP resend race-condition + cooldown hardening
  // ==========================================================

  it('allows only one concurrent OTP resend during the cooldown window', async () => {
    const resendEmail = `auth-resend-race-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Resend',
        lastName: 'Race',
        email: resendEmail,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
        role: 'customer',
      })
      .expect(201);

    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    expect(signupId).toEqual(expect.any(String));

    await pool.query(
      `
        UPDATE pending_signups
        SET last_otp_sent_at =
          NOW() - INTERVAL '61 seconds'
        WHERE id = $1
      `,
      [signupId],
    );

    const originalOtp = otpProvider.getEmailOtp(resendEmail);

    expect(originalOtp).toMatch(/^\d{6}$/);

    const [responseA, responseB] = await Promise.all([
      request(app).post('/auth/signup/resend').send({
        signupId,
      }),

      request(app).post('/auth/signup/resend').send({
        signupId,
      }),
    ]);

    const statuses = [responseA.status, responseB.status].sort((a, b) => a - b);

    expect(statuses).toEqual([200, 429]);

    const successfulResponse = responseA.status === 200 ? responseA : responseB;

    const rejectedResponse = responseA.status === 429 ? responseA : responseB;

    expect(successfulResponse.body.success).toBe(true);

    expect(successfulResponse.body.data.signupId).toBe(signupId);

    expect(successfulResponse.body.data.contactType).toBe('email');

    expect(successfulResponse.body.data.expiresAt).toBeDefined();

    expect(successfulResponse.body.data.otp).toBeUndefined();

    expect(rejectedResponse.body.success).toBe(false);

    expect(rejectedResponse.body.error.code).toBe('OTP_RESEND_TOO_SOON');

    expect(rejectedResponse.body.error.message).toBe('Please wait before requesting another OTP');

    const pendingResult = await pool.query<{
      id: string;
      otpHash: string;
      otpAttempts: number;
      lastOtpSentAt: Date;
    }>(
      `
        SELECT
          id,
          otp_hash AS "otpHash",
          otp_attempts AS "otpAttempts",
          last_otp_sent_at AS "lastOtpSentAt"
        FROM pending_signups
        WHERE id = $1
      `,
      [signupId],
    );

    expect(pendingResult.rows).toHaveLength(1);

    const pendingSignup = pendingResult.rows[0];

    expect(pendingSignup.id).toBe(signupId);

    expect(pendingSignup.otpHash).toBeTruthy();

    expect(pendingSignup.otpAttempts).toBe(0);

    expect(pendingSignup.lastOtpSentAt.getTime()).toBeGreaterThan(Date.now() - 10_000);

    const newOtp = otpProvider.getEmailOtp(resendEmail);

    expect(newOtp).toMatch(/^\d{6}$/);

    expect(newOtp).not.toBe(originalOtp);

    await pool.query(
      `
        DELETE FROM pending_signups
        WHERE id = $1
      `,
      [signupId],
    );
  });

  // ==========================================================
  // Task #13
  // Existing-account conflict + email normalization
  // ==========================================================

  it('rejects signup when the normalized email already belongs to an account', async () => {
    const accountEmail = `auth-existing-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Existing',
        lastName: 'Email',
        email: accountEmail,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
        role: 'customer',
      })
      .expect(201);

    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getEmailOtp(accountEmail);

    expect(otp).toMatch(/^\d{6}$/);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    expect(userId).toEqual(expect.any(String));

    const duplicateResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Duplicate',
        lastName: 'Email',
        email: `  ${accountEmail.toUpperCase()}  `,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
        role: 'customer',
      })
      .expect(409);

    expect(duplicateResponse.body.success).toBe(false);

    expect(duplicateResponse.body.error.code).toBe('ACCOUNT_ALREADY_EXISTS');

    expect(duplicateResponse.body.error.message).toBe('An account already exists for this contact');

    const pendingResult = await pool.query(
      `
        SELECT id
        FROM pending_signups
        WHERE contact_type = 'email'
          AND contact_value = $1
      `,
      [accountEmail],
    );

    expect(pendingResult.rows).toHaveLength(0);

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  // ==========================================================
  // Task #13
  // Existing-account conflict + phone normalization
  // ==========================================================

  it('rejects signup when the normalized phone already belongs to an account', async () => {
    const phone = `+9198${randomUUID().replace(/\D/g, '').slice(0, 8)}`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Existing',
        lastName: 'Phone',
        phone,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
        role: 'customer',
      })
      .expect(201);

    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getSmsOtp(phone);

    expect(otp).toMatch(/^\d{6}$/);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    expect(userId).toEqual(expect.any(String));

    const formattedPhone = `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`;

    expect(formattedPhone).not.toBe(phone);

    const duplicateResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Duplicate',
        lastName: 'Phone',
        phone: formattedPhone,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
        role: 'customer',
      })
      .expect(409);

    expect(duplicateResponse.body.success).toBe(false);

    expect(duplicateResponse.body.error.code).toBe('ACCOUNT_ALREADY_EXISTS');

    expect(duplicateResponse.body.error.message).toBe('An account already exists for this contact');

    const pendingResult = await pool.query(
      `
        SELECT id
        FROM pending_signups
        WHERE contact_type = 'phone'
          AND contact_value = $1
      `,
      [phone],
    );

    expect(pendingResult.rows).toHaveLength(0);

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  // ==========================================================
  // Task #14
  // Concurrent refresh-token race-condition hardening
  // ==========================================================

  it('allows only one concurrent refresh using the same token', async () => {
    const raceEmail = `auth-refresh-race-${randomUUID()}@example.com`;

    // ======================================================
    // 1. Create account
    // ======================================================

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Refresh',
        lastName: 'Race',
        email: raceEmail,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
        role: 'customer',
      })
      .expect(201);

    const signupId = signupResponse.body.data.signupId;

    expect(signupId).toEqual(expect.any(String));

    // ======================================================
    // 2. Verify signup
    // ======================================================

    const otp = otpProvider.getEmailOtp(raceEmail);

    expect(otp).toMatch(/^\d{6}$/);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    expect(userId).toEqual(expect.any(String));

    expect(verifyResponse.body.data.refreshToken).toBeUndefined();

    const verifyRefreshCookie = expectRefreshCookie(verifyResponse);

    expect(verifyRefreshCookie).toMatch(new RegExp(`^${env.AUTH_REFRESH_COOKIE_NAME}=`));

    // ======================================================
    // 3. Login and obtain original refresh token cookie
    // ======================================================

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({
        email: raceEmail,
        password: 'TestPassword123!',
      })
      .expect(200);

    expect(loginResponse.body.success).toBe(true);

    expect(loginResponse.body.data.userId).toBe(userId);

    expect(loginResponse.body.data.refreshToken).toBeUndefined();

    const originalRefreshCookie = expectRefreshCookie(loginResponse);

    const originalRefreshToken = getRefreshTokenFromCookie(originalRefreshCookie);

    expect(originalRefreshToken).toEqual(expect.any(String));

    expect(originalRefreshToken.length).toBeGreaterThan(20);

    // ======================================================
    // 4. Resolve exact refresh-token family
    // ======================================================

    const originalRefreshTokenHash = hashRefreshToken(originalRefreshToken);

    const originalTokenResult = await pool.query<{
      familyId: string;
    }>(
      `
        SELECT
          family_id AS "familyId"
        FROM refresh_tokens
        WHERE token_hash = $1
        LIMIT 1
      `,
      [originalRefreshTokenHash],
    );

    expect(originalTokenResult.rows).toHaveLength(1);

    const originalFamilyId = originalTokenResult.rows[0].familyId;

    expect(originalFamilyId).toEqual(expect.any(String));

    // ======================================================
    // 5. Race two refresh requests using SAME cookie
    // ======================================================

    const [responseA, responseB] = await Promise.all([
      request(app).post('/auth/refresh').set('Cookie', originalRefreshCookie),

      request(app).post('/auth/refresh').set('Cookie', originalRefreshCookie),
    ]);

    const statuses = [responseA.status, responseB.status].sort((a, b) => a - b);

    expect(statuses).toEqual([200, 401]);

    const successfulResponse = responseA.status === 200 ? responseA : responseB;

    const rejectedResponse = responseA.status === 401 ? responseA : responseB;

    // ======================================================
    // 6. Successful request receives a new token cookie
    // ======================================================

    expect(successfulResponse.body.success).toBe(true);

    expect(successfulResponse.body.data.accessToken).toEqual(expect.any(String));

    expect(successfulResponse.body.data.refreshToken).toBeUndefined();

    const rotatedRefreshCookie = expectRefreshCookie(successfulResponse);

    expect(rotatedRefreshCookie).not.toBe(originalRefreshCookie);

    // ======================================================
    // 7. Losing request detects token reuse
    // ======================================================

    expect(rejectedResponse.body.success).toBe(false);

    expect(rejectedResponse.body.error.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');

    // ======================================================
    // 8. Inspect only the family involved in this race
    // ======================================================

    const familyResult = await pool.query<{
      familyId: string;
      revokedAt: Date | null;
    }>(
      `
        SELECT
          family_id AS "familyId",
          revoked_at AS "revokedAt"
        FROM refresh_tokens
        WHERE family_id = $1
        ORDER BY issued_at ASC
      `,
      [originalFamilyId],
    );

    expect(familyResult.rows.length).toBeGreaterThanOrEqual(2);

    const familyIds = new Set(familyResult.rows.map((row) => row.familyId));

    expect(familyIds.size).toBe(1);

    expect(familyIds.has(originalFamilyId)).toBe(true);

    expect(familyResult.rows.every((row) => row.revokedAt !== null)).toBe(true);

    // ======================================================
    // 9. Rotated token must also be unusable
    // ======================================================

    await request(app).post('/auth/refresh').set('Cookie', rotatedRefreshCookie).expect(401);

    // ======================================================
    // 10. Cleanup
    // ======================================================

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  // ==========================================================
  // Task #15
  // Login security / error edge-case tests
  // ==========================================================

  it('rejects login with an incorrect password using generic credentials error', async () => {
    const loginEmail = `auth-login-wrong-password-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Login',
        lastName: 'Security',
        email: loginEmail,
        password: 'CorrectPassword123!',
        confirmPassword: 'CorrectPassword123!',
        role: 'customer',
      })
      .expect(201);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getEmailOtp(loginEmail);

    await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const response = await request(app)
      .post('/auth/login')
      .send({
        email: loginEmail,
        password: 'WrongPassword123!',
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');

    expect(response.body.error.message).toBe('Invalid email/phone or password');

    expect(response.body.data).toBeUndefined();

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = (
          SELECT id
          FROM users
          WHERE email = $1
        )
      `,
      [loginEmail],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE email = $1
      `,
      [loginEmail],
    );
  });

  it('rejects login for an unknown email with the same generic credentials error', async () => {
    const unknownEmail = `auth-login-unknown-${randomUUID()}@example.com`;

    const response = await request(app)
      .post('/auth/login')
      .send({
        email: unknownEmail,
        password: 'SomePassword123!',
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');

    expect(response.body.error.message).toBe('Invalid email/phone or password');

    expect(response.body.data).toBeUndefined();
  });

  it('rejects login for an unknown phone with the same generic credentials error', async () => {
    const unknownPhone = `+9198${randomUUID().replace(/\D/g, '').slice(0, 8)}`;

    const response = await request(app)
      .post('/auth/login')
      .send({
        phone: unknownPhone,
        password: 'SomePassword123!',
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');

    expect(response.body.error.message).toBe('Invalid email/phone or password');

    expect(response.body.data).toBeUndefined();
  });

  it('rejects login for a suspended account', async () => {
    const suspendedEmail = `auth-login-suspended-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Suspended',
        lastName: 'Account',
        email: suspendedEmail,
        password: 'CorrectPassword123!',
        confirmPassword: 'CorrectPassword123!',
        role: 'customer',
      })
      .expect(201);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getEmailOtp(suspendedEmail);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    await pool.query(
      `
        UPDATE users
        SET status = 'suspended'
        WHERE id = $1
      `,
      [userId],
    );

    const response = await request(app)
      .post('/auth/login')
      .send({
        email: suspendedEmail,
        password: 'CorrectPassword123!',
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');

    expect(response.body.error.message).toBe('Account is not active');

    expect(response.body.data).toBeUndefined();

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  it('rejects login for a banned account', async () => {
    const bannedEmail = `auth-login-banned-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Banned',
        lastName: 'Account',
        email: bannedEmail,
        password: 'CorrectPassword123!',
        confirmPassword: 'CorrectPassword123!',
        role: 'customer',
      })
      .expect(201);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getEmailOtp(bannedEmail);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    await pool.query(
      `
        UPDATE users
        SET status = 'banned'
        WHERE id = $1
      `,
      [userId],
    );

    const response = await request(app)
      .post('/auth/login')
      .send({
        email: bannedEmail,
        password: 'CorrectPassword123!',
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');

    expect(response.body.error.message).toBe('Account is not active');

    expect(response.body.data).toBeUndefined();

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  it('does not expose password hashes or credentials in the login response', async () => {
    const securityEmail = `auth-login-response-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Response',
        lastName: 'Security',
        email: securityEmail,
        password: 'CorrectPassword123!',
        confirmPassword: 'CorrectPassword123!',
        role: 'customer',
      })
      .expect(201);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getEmailOtp(securityEmail);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    const response = await request(app)
      .post('/auth/login')
      .send({
        email: securityEmail,
        password: 'CorrectPassword123!',
      })
      .expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.data.userId).toBe(userId);

    expect(response.body.data.accessToken).toEqual(expect.any(String));

    expect(response.body.data.refreshToken).toBeUndefined();

    expectRefreshCookie(response);

    expect(response.body.data.password).toBeUndefined();

    expect(response.body.data.passwordHash).toBeUndefined();

    expect(JSON.stringify(response.body)).not.toContain('$argon2');

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  it('returns the same authentication error contract for unknown email and wrong password', async () => {
    const existingEmail = `auth-login-enumeration-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Enumeration',
        lastName: 'Test',
        email: existingEmail,
        password: 'CorrectPassword123!',
        confirmPassword: 'CorrectPassword123!',
        role: 'customer',
      })
      .expect(201);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getEmailOtp(existingEmail);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    const wrongPasswordResponse = await request(app)
      .post('/auth/login')
      .send({
        email: existingEmail,
        password: 'WrongPassword123!',
      })
      .expect(401);

    const unknownEmailResponse = await request(app)
      .post('/auth/login')
      .send({
        email: `unknown-${randomUUID()}@example.com`,
        password: 'WrongPassword123!',
      })
      .expect(401);

    expect(wrongPasswordResponse.body.success).toBe(false);

    expect(unknownEmailResponse.body.success).toBe(false);

    expect(wrongPasswordResponse.body.error).toEqual(unknownEmailResponse.body.error);

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  it('logs in successfully with a normalized email value', async () => {
    const normalizedEmail = `auth-login-email-normalization-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Email',
        lastName: 'Normalization',
        email: normalizedEmail,
        password: 'CorrectPassword123!',
        confirmPassword: 'CorrectPassword123!',
        role: 'customer',
      })
      .expect(201);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getEmailOtp(normalizedEmail);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({
        email: `  ${normalizedEmail.toUpperCase()}  `,
        password: 'CorrectPassword123!',
      })
      .expect(200);

    expect(loginResponse.body.success).toBe(true);

    expect(loginResponse.body.data.userId).toBe(userId);

    expect(loginResponse.body.data.accessToken).toEqual(expect.any(String));

    expect(loginResponse.body.data.refreshToken).toBeUndefined();

    expectRefreshCookie(loginResponse);

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  it('logs in successfully with a normalized phone value', async () => {
    const phone = `+9198${randomUUID().replace(/\D/g, '').slice(0, 8)}`;

    const signupResponse = await request(app)
      .post('/auth/signup')
      .send({
        firstName: 'Phone',
        lastName: 'Normalization',
        phone,
        password: 'CorrectPassword123!',
        confirmPassword: 'CorrectPassword123!',
        role: 'customer',
      })
      .expect(201);

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getSmsOtp(phone);

    const verifyResponse = await request(app)
      .post('/auth/signup/verify')
      .send({
        signupId,
        otp,
      })
      .expect(200);

    const userId = verifyResponse.body.data.userId;

    const formattedPhone = `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`;

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({
        phone: formattedPhone,
        password: 'CorrectPassword123!',
      })
      .expect(200);

    expect(loginResponse.body.success).toBe(true);

    expect(loginResponse.body.data.userId).toBe(userId);

    expect(loginResponse.body.data.accessToken).toEqual(expect.any(String));

    expect(loginResponse.body.data.refreshToken).toBeUndefined();

    expectRefreshCookie(loginResponse);

    await pool.query(
      `
        DELETE FROM refresh_tokens
        WHERE user_id = $1
      `,
      [userId],
    );

    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId],
    );
  });

  // ==========================================================
  // Cleanup
  // ==========================================================

  afterAll(async () => {
    if (!email) {
      otpProvider.clear();
      await pool.end();
      return;
    }

    const userResult = await pool.query<{
      id: string;
    }>(
      `
        SELECT id
        FROM users
        WHERE email = $1
      `,
      [email],
    );

    const userId = userResult.rows[0]?.id;

    if (userId) {
      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM users
          WHERE id = $1
        `,
        [userId],
      );
    }

    await pool.query(
      `
        DELETE FROM pending_signups
        WHERE contact_type = 'email'
          AND contact_value = $1
      `,
      [email],
    );

    otpProvider.clear();

    await pool.end();
  });
});
