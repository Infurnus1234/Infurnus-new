// auth.integration.test.ts

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
  private readonly emailOtps = new Map<string, string>();
  private readonly smsOtps = new Map<string, string>();

  async sendEmailOtp(email: string, otp: string): Promise<void> {
    this.emailOtps.set(email, otp);
  }

  async sendSmsOtp(phone: string, otp: string): Promise<void> {
    this.smsOtps.set(phone, otp);
  }

  getEmailOtp(email: string): string {
    const otp = this.emailOtps.get(email);

    if (!otp) {
      throw new Error(`No email OTP captured for ${email}`);
    }

    return otp;
  }

  getSmsOtp(phone: string): string {
    const otp = this.smsOtps.get(phone);

    if (!otp) {
      throw new Error(`No SMS OTP captured for ${phone}`);
    }

    return otp;
  }

  clear(): void {
    this.emailOtps.clear();
    this.smsOtps.clear();
  }
}

function uniqueEmail(prefix = 'auth-integration'): string {
  return `${prefix}-${randomUUID()}@example.com`;
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

  const cookieValue = refreshCookie.split(';', 1)[0];

  if (!cookieValue) {
    throw new Error('Refresh token cookie value was not found');
  }

  return cookieValue;
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

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  describe('signup', () => {
    it('creates a pending signup and completes signup verification', async () => {
      const email = uniqueEmail();

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Integration',
        lastName: 'Test',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);
      expect(signupResponse.body.success).toBe(true);
      expect(signupResponse.body.data.signupId).toEqual(expect.any(String));
      expect(signupResponse.body.data.contactType).toBe('email');
      expect(signupResponse.body.data.otp).toBeUndefined();

      const signupId = signupResponse.body.data.signupId;

      const pendingResult = await pool.query<{
        id: string;
        contactType: string;
        contactValue: string;
        otpHash: string;
        otpAttempts: number;
        lastOtpSentAt: Date | null;
      }>(
        `
          SELECT
            id,
            contact_type AS "contactType",
            contact_value AS "contactValue",
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

      expect(pendingSignup).toBeDefined();

      if (!pendingSignup) {
        throw new Error('Expected pending signup to exist');
      }

      expect(pendingSignup.id).toBe(signupId);
      expect(pendingSignup.contactType).toBe('email');
      expect(pendingSignup.contactValue).toBe(email);
      expect(pendingSignup.otpHash).toBeTruthy();
      expect(pendingSignup.otpAttempts).toBe(0);
      expect(pendingSignup.lastOtpSentAt).toBeInstanceOf(Date);

      const otp = otpProvider.getEmailOtp(email);

      expect(otp).toMatch(/^\d{6}$/);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.success).toBe(true);

      const userId = verifyResponse.body.data.userId;

      expect(userId).toEqual(expect.any(String));

      const userResult = await pool.query<{
        id: string;
        email: string;
        role: string;
        status: string;
      }>(
        `
          SELECT
            id,
            email,
            role,
            status
          FROM users
          WHERE id = $1
        `,
        [userId],
      );

      expect(userResult.rows).toHaveLength(1);

      const user = userResult.rows[0];

      expect(user).toBeDefined();

      if (!user) {
        throw new Error('Expected created user to exist');
      }

      expect(user.id).toBe(userId);
      expect(user.email).toBe(email);
      expect(user.role).toBe('customer');

      const credentialsResult = await pool.query<{
        userId: string;
        passwordHash: string;
      }>(
        `
          SELECT
            user_id AS "userId",
            password_hash AS "passwordHash"
          FROM user_credentials
          WHERE user_id = $1
        `,
        [userId],
      );

      expect(credentialsResult.rows).toHaveLength(1);

      const credentials = credentialsResult.rows[0];

      expect(credentials).toBeDefined();

      if (!credentials) {
        throw new Error('Expected user credentials to exist');
      }

      expect(credentials.userId).toBe(userId);
      expect(credentials.passwordHash).toBeTruthy();

      const pendingAfterVerification = await pool.query(
        `
          SELECT id
          FROM pending_signups
          WHERE id = $1
        `,
        [signupId],
      );

      expect(pendingAfterVerification.rows).toHaveLength(0);

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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

    it('rejects an incorrect OTP', async () => {
      const email = uniqueEmail('auth-invalid-otp');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Invalid',
        lastName: 'OTP',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp: '000000',
      });

      expect(verifyResponse.status).toBe(400);
      expect(verifyResponse.body.success).toBe(false);

      await pool.query(
        `
          DELETE FROM pending_signups
          WHERE id = $1
        `,
        [signupId],
      );
    });

    it('increments OTP attempts after an incorrect OTP', async () => {
      const email = uniqueEmail('auth-otp-attempt');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'OTP',
        lastName: 'Attempt',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp: '000000',
      });

      expect(verifyResponse.status).toBe(400);

      const pendingResult = await pool.query<{
        otpAttempts: number;
      }>(
        `
          SELECT
            otp_attempts AS "otpAttempts"
          FROM pending_signups
          WHERE id = $1
        `,
        [signupId],
      );

      expect(pendingResult.rows).toHaveLength(1);

      const pendingSignup = pendingResult.rows[0];

      expect(pendingSignup).toBeDefined();

      if (!pendingSignup) {
        throw new Error('Expected pending signup to exist');
      }

      expect(pendingSignup.otpAttempts).toBe(1);

      await pool.query(
        `
          DELETE FROM pending_signups
          WHERE id = $1
        `,
        [signupId],
      );
    });

    it('allows only one concurrent signup for the same email', async () => {
      const email = uniqueEmail('auth-race');

      const payload = {
        firstName: 'Race',
        lastName: 'Test',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      };

      const [responseA, responseB] = await Promise.all([
        request(app).post('/auth/signup').send(payload),
        request(app).post('/auth/signup').send(payload),
      ]);

      const statuses = [responseA.status, responseB.status].sort((a, b) => a - b);

      expect(statuses).toEqual([201, 409]);

      const successfulResponse = responseA.status === 201 ? responseA : responseB;

      const signupId = successfulResponse.body.data.signupId;

      expect(signupId).toEqual(expect.any(String));

      await pool.query(
        `
          DELETE FROM pending_signups
          WHERE id = $1
        `,
        [signupId],
      );
    });

    it('rejects signup when passwords do not match', async () => {
      const response = await request(app)
        .post('/auth/signup')
        .send({
          firstName: 'Password',
          lastName: 'Mismatch',
          email: uniqueEmail('auth-password-mismatch'),
          password: 'StrongPassword123!',
          confirmPassword: 'DifferentPassword123!',
          role: 'customer',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('rejects signup without email or phone', async () => {
      const response = await request(app).post('/auth/signup').send({
        firstName: 'Missing',
        lastName: 'Contact',
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('rejects an invalid role', async () => {
      const response = await request(app)
        .post('/auth/signup')
        .send({
          firstName: 'Invalid',
          lastName: 'Role',
          email: uniqueEmail('auth-invalid-role'),
          password: 'StrongPassword123!',
          confirmPassword: 'StrongPassword123!',
          role: 'superadmin',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('login', () => {
    it('completes signup and logs in with valid credentials', async () => {
      const email = uniqueEmail('auth-login');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Login',
        lastName: 'Test',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.data.accessToken).toEqual(expect.any(String));

      expect(loginResponse.body.data.passwordHash).toBeUndefined();
      expect(loginResponse.body.data.password_hash).toBeUndefined();

      const refreshCookie = expectRefreshCookie(loginResponse);

      expect(refreshCookie).toContain(`${env.AUTH_REFRESH_COOKIE_NAME}=`);

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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

    it('rejects invalid credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: uniqueEmail('auth-invalid-login'),
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('rejects a suspended account', async () => {
      const email = uniqueEmail('auth-suspended');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Suspended',
        lastName: 'User',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      await pool.query(
        `
          UPDATE users
          SET status = 'suspended'
          WHERE id = $1
        `,
        [userId],
      );

      const response = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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

    it('rejects a banned account', async () => {
      const email = uniqueEmail('auth-banned');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Banned',
        lastName: 'User',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      await pool.query(
        `
          UPDATE users
          SET status = 'banned'
          WHERE id = $1
        `,
        [userId],
      );

      const response = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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
  });

  describe('refresh', () => {
    it('refreshes and rotates the refresh token', async () => {
      const email = uniqueEmail('auth-refresh');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Refresh',
        lastName: 'Test',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const originalCookie = expectRefreshCookie(loginResponse);
      const originalRefreshToken = getRefreshTokenFromCookie(originalCookie);

      const originalTokenResult = await pool.query<{
        id: string;
        familyId: string;
        tokenHash: string;
      }>(
        `
          SELECT
            id,
            family_id AS "familyId",
            token_hash AS "tokenHash"
          FROM refresh_tokens
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId],
      );

      expect(originalTokenResult.rows).toHaveLength(1);

      const originalToken = originalTokenResult.rows[0];

      expect(originalToken).toBeDefined();

      if (!originalToken) {
        throw new Error('Expected original refresh token to exist');
      }

      expect(originalToken.tokenHash).toBe(hashRefreshToken(originalRefreshToken));

      const refreshResponse = await request(app)
        .post('/auth/refresh')
        .set('Cookie', originalCookie);

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.success).toBe(true);
      expect(refreshResponse.body.data.accessToken).toEqual(expect.any(String));

      const replacementCookie = expectRefreshCookie(refreshResponse);
      const replacementRefreshToken = getRefreshTokenFromCookie(replacementCookie);

      expect(replacementRefreshToken).not.toBe(originalRefreshToken);

      const tokenRows = await pool.query<{
        id: string;
        familyId: string;
        revokedAt: Date | null;
        replacedBy: string | null;
      }>(
        `
          SELECT
            id,
            family_id AS "familyId",
            revoked_at AS "revokedAt",
            replaced_by AS "replacedBy"
          FROM refresh_tokens
          WHERE user_id = $1
          ORDER BY created_at ASC
        `,
        [userId],
      );

      expect(tokenRows.rows.length).toBeGreaterThanOrEqual(2);

      const oldToken = tokenRows.rows.find((token) => token.id === originalToken.id);

      expect(oldToken).toBeDefined();

      if (!oldToken) {
        throw new Error('Expected old refresh token');
      }

      expect(oldToken.revokedAt).toBeInstanceOf(Date);
      expect(oldToken.replacedBy).toEqual(expect.any(String));
      expect(oldToken.familyId).toBe(originalToken.familyId);

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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

    it('rejects refresh without a cookie', async () => {
      const response = await request(app).post('/auth/refresh');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('rejects an invalid refresh cookie', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `${env.AUTH_REFRESH_COOKIE_NAME}=invalid-refresh-token`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('detects reuse of a rotated refresh token', async () => {
      const email = uniqueEmail('auth-reuse');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Reuse',
        lastName: 'Test',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const originalCookie = expectRefreshCookie(loginResponse);
      const originalRefreshToken = getRefreshTokenFromCookie(originalCookie);

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
        [hashRefreshToken(originalRefreshToken)],
      );

      expect(originalTokenResult.rows).toHaveLength(1);

      const originalToken = originalTokenResult.rows[0];

      expect(originalToken).toBeDefined();

      if (!originalToken) {
        throw new Error('Expected original refresh token to exist');
      }

      const originalFamilyId = originalToken.familyId;

      expect(originalFamilyId).toEqual(expect.any(String));

      const firstRefresh = await request(app).post('/auth/refresh').set('Cookie', originalCookie);

      expect(firstRefresh.status).toBe(200);

      const reuseResponse = await request(app).post('/auth/refresh').set('Cookie', originalCookie);

      expect(reuseResponse.status).toBe(401);
      expect(reuseResponse.body.success).toBe(false);

      const familyTokens = await pool.query<{
        familyId: string;
        revokedAt: Date | null;
      }>(
        `
          SELECT
            family_id AS "familyId",
            revoked_at AS "revokedAt"
          FROM refresh_tokens
          WHERE family_id = $1
          ORDER BY created_at ASC
        `,
        [originalFamilyId],
      );

      expect(familyTokens.rows.length).toBeGreaterThanOrEqual(2);

      for (const token of familyTokens.rows) {
        expect(token.familyId).toBe(originalFamilyId);
        expect(token.revokedAt).toBeInstanceOf(Date);
      }

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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

    it('uses the current database role during refresh', async () => {
      const email = uniqueEmail('auth-current-role');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Role',
        lastName: 'Test',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const refreshCookie = expectRefreshCookie(loginResponse);

      await pool.query(
        `
          UPDATE users
          SET role = 'admin'
          WHERE id = $1
        `,
        [userId],
      );

      const refreshResponse = await request(app).post('/auth/refresh').set('Cookie', refreshCookie);

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.success).toBe(true);
      expect(refreshResponse.body.data.accessToken).toEqual(expect.any(String));

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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

    it('rejects refresh for a suspended account', async () => {
      const email = uniqueEmail('auth-refresh-suspended');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Refresh',
        lastName: 'Suspended',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const refreshCookie = expectRefreshCookie(loginResponse);

      await pool.query(
        `
          UPDATE users
          SET status = 'suspended'
          WHERE id = $1
        `,
        [userId],
      );

      const refreshResponse = await request(app).post('/auth/refresh').set('Cookie', refreshCookie);

      expect(refreshResponse.status).toBe(401);
      expect(refreshResponse.body.success).toBe(false);

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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

    it('rejects refresh for a banned account', async () => {
      const email = uniqueEmail('auth-refresh-banned');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Refresh',
        lastName: 'Banned',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const refreshCookie = expectRefreshCookie(loginResponse);

      await pool.query(
        `
          UPDATE users
          SET status = 'banned'
          WHERE id = $1
        `,
        [userId],
      );

      const refreshResponse = await request(app).post('/auth/refresh').set('Cookie', refreshCookie);

      expect(refreshResponse.status).toBe(401);
      expect(refreshResponse.body.success).toBe(false);

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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
  });

  describe('logout', () => {
    it('logs out and revokes the refresh token', async () => {
      const email = uniqueEmail('auth-logout');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Logout',
        lastName: 'Test',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const refreshCookie = expectRefreshCookie(loginResponse);

      const logoutResponse = await request(app).post('/auth/logout').set('Cookie', refreshCookie);

      expect(logoutResponse.status).toBe(204);

      const refreshAfterLogout = await request(app)
        .post('/auth/refresh')
        .set('Cookie', refreshCookie);

      expect(refreshAfterLogout.status).toBe(401);

      const revokedResult = await pool.query<{
        revokedAt: Date | null;
      }>(
        `
          SELECT
            revoked_at AS "revokedAt"
          FROM refresh_tokens
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId],
      );

      expect(revokedResult.rows).toHaveLength(1);

      const revokedToken = revokedResult.rows[0];

      expect(revokedToken).toBeDefined();

      if (!revokedToken) {
        throw new Error('Expected refresh token to exist');
      }

      expect(revokedToken.revokedAt).toBeInstanceOf(Date);

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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

    it('rejects logout without a refresh cookie', async () => {
      const response = await request(app).post('/auth/logout');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('cookie security', () => {
    it('sets the refresh token as an HttpOnly cookie', async () => {
      const email = uniqueEmail('auth-cookie');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Cookie',
        lastName: 'Test',
        email,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      const signupId = signupResponse.body.data.signupId;
      const otp = otpProvider.getEmailOtp(email);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const cookies = getSetCookieHeaders(loginResponse);

      const refreshCookie = cookies.find((cookie) =>
        cookie.startsWith(`${env.AUTH_REFRESH_COOKIE_NAME}=`),
      );

      expect(refreshCookie).toBeDefined();

      if (!refreshCookie) {
        throw new Error('Expected refresh cookie');
      }

      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('SameSite');

      await pool.query(
        `
          DELETE FROM refresh_tokens
          WHERE user_id = $1
        `,
        [userId],
      );

      await pool.query(
        `
          DELETE FROM user_credentials
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
  });

  afterAll(async () => {
    otpProvider.clear();
    await pool.end();
  });
});
