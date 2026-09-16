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

// ============================================================
// Test OTP provider
//
// Mirrors the production provider contract:
//
//   sendSmsOtp(phone)
//   verifySmsOtp(sessionToken, otp)
//   resendSmsOtp(sessionToken)
//
// The OTP is generated and owned by this test provider.
// Production code never generates or stores the OTP.
// ============================================================

interface TestOtpSession {
  phone: string;
  otp: string;
  expiresAt: string;
  attemptsRemaining: number;
  verified: boolean;
}

class TestOtpProvider implements OtpProvider {
  private readonly sessions = new Map<string, TestOtpSession>();

  private readonly latestSessionByPhone = new Map<string, string>();

  async sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    const sessionId = randomUUID();
    const sessionToken = randomUUID();

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const otp = '123456';

    this.sessions.set(sessionToken, {
      phone,
      otp,
      expiresAt,
      attemptsRemaining: 5,
      verified: false,
    });

    this.latestSessionByPhone.set(phone, sessionToken);

    return {
      sessionId,
      sessionToken,
      expiresAt,
    };
  }

  async sendEmailOtp(email: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    return this.sendSmsOtp(email);
  }

  async verifySmsOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      throw new Error('Test OTP session not found');
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      return {
        verified: false,
        attemptsRemaining: session.attemptsRemaining,
      };
    }

    if (session.verified) {
      return {
        verified: true,
        attemptsRemaining: session.attemptsRemaining,
      };
    }

    if (session.attemptsRemaining <= 0) {
      return {
        verified: false,
        attemptsRemaining: 0,
      };
    }

    if (otp !== session.otp) {
      session.attemptsRemaining -= 1;

      return {
        verified: false,
        attemptsRemaining: session.attemptsRemaining,
      };
    }

    session.verified = true;

    return {
      verified: true,
      attemptsRemaining: session.attemptsRemaining,
    };
  }

  async resendSmsOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      throw new Error('Test OTP session not found');
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    session.otp = '123456';
    session.expiresAt = expiresAt;
    session.attemptsRemaining = 5;
    session.verified = false;

    return {
      expiresAt,
    };
  }

  async resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendSmsOtp(sessionToken);
  }

  getSmsOtp(phone: string): string {
    const sessionToken = this.latestSessionByPhone.get(phone);

    if (!sessionToken) {
      throw new Error(`No SMS OTP session captured for ${phone}`);
    }

    const session = this.sessions.get(sessionToken);

    if (!session) {
      throw new Error(`No SMS OTP captured for ${phone}`);
    }

    return session.otp;
  }

  getLatestSessionToken(phone: string): string {
    const sessionToken = this.latestSessionByPhone.get(phone);

    if (!sessionToken) {
      throw new Error(`No OTP session captured for ${phone}`);
    }

    return sessionToken;
  }

  clear(): void {
    this.sessions.clear();
    this.latestSessionByPhone.clear();
  }
}

// ============================================================
// Test data helpers
// ============================================================

function uniqueEmail(prefix = 'auth-integration'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

function uniquePhone(_prefix = 'auth'): string {
  const digits = randomUUID().replace(/\D/g, '').slice(0, 10).padEnd(10, '1');

  return `+91${digits}`;
}

// ============================================================
// Cookie helpers
// ============================================================

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

// ============================================================
// Auth integration
// ============================================================

describe.sequential('Auth integration', () => {
  const otpProvider = new TestOtpProvider();

  const app = createApp(new PostgresUserRepository(pool), otpProvider, {
    enableAuthRateLimiting: false,
    enableAuthCsrfProtection: false,
  });

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  // ========================================================
  // Helpers
  // ========================================================

  async function createVerifiedUser(_prefix: string): Promise<{
    userId: string;
    email: string;
    phone: string;
  }> {
    const email = uniqueEmail(_prefix);

    const phone = uniquePhone(_prefix);

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Session',
      lastName: 'Test',
      email,
      phone,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'customer',
    });

    expect(signupResponse.status).toBe(201);

    const signupId = signupResponse.body.data.signupId;

    expect(signupId).toEqual(expect.any(String));

    const otp = otpProvider.getSmsOtp(phone);

    const verifyResponse = await request(app).post('/auth/signup/verify').send({
      signupId,
      otp,
    });

    expect(verifyResponse.status).toBe(200);

    expect(verifyResponse.body.success).toBe(true);

    return {
      userId: verifyResponse.body.data.userId,
      email,
      phone,
    };
  }

  async function loginVerifiedUser(
    email: string,
    phone: string,
  ): Promise<{
    challengeId: string;
    accessToken: string;
    refreshCookie: string;
    loginResponse: Response;
    verifyResponse: Response;
  }> {
    const loginResponse = await request(app).post('/auth/login').send({
      email,
      password: 'StrongPassword123!',
    });

    expect(loginResponse.status).toBe(200);

    expect(loginResponse.body.success).toBe(true);

    const challengeId = loginResponse.body.data.challengeId;

    expect(challengeId).toEqual(expect.any(String));

    expect(loginResponse.body.data.expiresAt).toEqual(expect.any(String));

    expect(loginResponse.body.data.accessToken).toBeUndefined();

    expect(loginResponse.body.data.passwordHash).toBeUndefined();

    expect(getSetCookieHeaders(loginResponse)).toHaveLength(0);

    const otp = otpProvider.getSmsOtp(phone);

    const verifyResponse = await request(app).post('/auth/login/verify').send({
      challengeId,
      otp,
    });

    expect(verifyResponse.status).toBe(200);

    expect(verifyResponse.body.success).toBe(true);

    const accessToken = verifyResponse.body.data.accessToken;

    expect(accessToken).toEqual(expect.any(String));

    expect(verifyResponse.body.data.passwordHash).toBeUndefined();

    expect(verifyResponse.body.data.password_hash).toBeUndefined();

    const refreshCookie = expectRefreshCookie(verifyResponse);

    return {
      challengeId,
      accessToken,
      refreshCookie,
      loginResponse,
      verifyResponse,
    };
  }

  async function cleanupUser(userId: string): Promise<void> {
    await pool.query(
      `
          DELETE FROM login_challenges
          WHERE user_id = $1
        `,
      [userId],
    );

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
  }

  async function cleanupSignup(signupId: string): Promise<void> {
    await pool.query(
      `
          DELETE FROM pending_signups
          WHERE id = $1
        `,
      [signupId],
    );
  }

  // ========================================================
  // Signup
  // ========================================================

  describe('signup', () => {
    it('creates a phone-verified pending signup and completes verification', async () => {
      const email = uniqueEmail();

      const phone = uniquePhone();

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Integration',
        lastName: 'Test',
        email,
        phone,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      expect(signupResponse.body.success).toBe(true);

      expect(signupResponse.body.data.signupId).toEqual(expect.any(String));

      expect(signupResponse.body.data.contactType).toBe('phone');

      expect(signupResponse.body.data.otp).toBeUndefined();

      const signupId = signupResponse.body.data.signupId;

      const pendingResult = await pool.query<{
        id: string;
        email: string | null;
        contactType: string;
        contactValue: string;
        otpHash: string | null;
        otpExpiresAt: Date | null;
        otpAttempts: number;
        lastOtpSentAt: Date | null;
        otpProvider: string | null;
        otpProviderSessionId: string | null;
        otpProviderSessionToken: string | null;
        otpProviderExpiresAt: Date | null;
      }>(
        `
                SELECT
                  id,
                  email,
                  contact_type AS "contactType",
                  contact_value AS "contactValue",
                  otp_hash AS "otpHash",
                  otp_expires_at AS "otpExpiresAt",
                  otp_attempts AS "otpAttempts",
                  last_otp_sent_at AS "lastOtpSentAt",
                  otp_provider AS "otpProvider",
                  otp_provider_session_id AS "otpProviderSessionId",
                  otp_provider_session_token AS "otpProviderSessionToken",
                  otp_provider_expires_at AS "otpProviderExpiresAt"
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

      expect(pendingSignup.email).toBe(email);

      expect(pendingSignup.contactType).toBe('phone');

      expect(pendingSignup.contactValue).toBe(phone);

      expect(pendingSignup.otpHash).toBeNull();

      expect(pendingSignup.otpExpiresAt).toBeNull();

      expect(pendingSignup.otpAttempts).toBe(0);

      expect(pendingSignup.lastOtpSentAt).toBeInstanceOf(Date);

      expect(pendingSignup.otpProvider).toBe('sendmator');

      expect(pendingSignup.otpProviderSessionId).toEqual(expect.any(String));

      expect(pendingSignup.otpProviderSessionToken).toEqual(expect.any(String));

      expect(pendingSignup.otpProviderExpiresAt).toBeInstanceOf(Date);

      const otp = otpProvider.getSmsOtp(phone);

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
        email: string | null;
        phone: string | null;
        emailVerified: boolean;
        phoneVerified: boolean;
        role: string;
        status: string;
      }>(
        `
                SELECT
                  id,
                  email,
                  phone,
                  email_verified AS "emailVerified",
                  phone_verified AS "phoneVerified",
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

      expect(user.phone).toBe(phone);

      expect(user.emailVerified).toBe(false);

      expect(user.phoneVerified).toBe(true);

      expect(user.role).toBe('customer');

      expect(user.status).toBe('active');

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

      await cleanupUser(userId);
    });

    it('rejects an incorrect provider OTP', async () => {
      const email = uniqueEmail('auth-invalid-otp');

      const phone = uniquePhone('auth-invalid-otp');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Invalid',
        lastName: 'OTP',
        email,
        phone,
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

      await cleanupSignup(signupId);
    });

    it('does not store or locally increment OTP attempts', async () => {
      const email = uniqueEmail('auth-otp-attempt');

      const phone = uniquePhone('auth-otp-attempt');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'OTP',
        lastName: 'Attempt',
        email,
        phone,
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
        otpHash: string | null;
        otpAttempts: number;
      }>(
        `
                SELECT
                  otp_hash AS "otpHash",
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

      expect(pendingSignup.otpHash).toBeNull();

      expect(pendingSignup.otpAttempts).toBe(0);

      await cleanupSignup(signupId);
    });

    it('allows only one concurrent signup for the same phone', async () => {
      const phone = uniquePhone('auth-race');

      const payloadA = {
        firstName: 'Race',
        lastName: 'Test',
        email: uniqueEmail('auth-race-a'),
        phone,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      };

      const payloadB = {
        firstName: 'Race',
        lastName: 'Test',
        email: uniqueEmail('auth-race-b'),
        phone,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      };

      const [responseA, responseB] = await Promise.all([
        request(app).post('/auth/signup').send(payloadA),

        request(app).post('/auth/signup').send(payloadB),
      ]);

      const statuses = [responseA.status, responseB.status].sort((a, b) => a - b);

      expect(statuses).toEqual([201, 409]);

      const successfulResponse = responseA.status === 201 ? responseA : responseB;

      const signupId = successfulResponse.body.data.signupId;

      expect(signupId).toEqual(expect.any(String));

      await cleanupSignup(signupId);
    });

    it('rejects signup when passwords do not match', async () => {
      const response = await request(app)
        .post('/auth/signup')
        .send({
          firstName: 'Password',
          lastName: 'Mismatch',
          email: uniqueEmail('auth-password-mismatch'),
          phone: uniquePhone('auth-password-mismatch'),
          password: 'StrongPassword123!',
          confirmPassword: 'DifferentPassword123!',
          role: 'customer',
        });

      expect(response.status).toBe(400);

      expect(response.body.success).toBe(false);
    });

    it('rejects signup without a phone number', async () => {
      const response = await request(app)
        .post('/auth/signup')
        .send({
          firstName: 'Missing',
          lastName: 'Phone',
          email: uniqueEmail('auth-missing-phone'),
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
          phone: uniquePhone('auth-invalid-role'),
          password: 'StrongPassword123!',
          confirmPassword: 'StrongPassword123!',
          role: 'superadmin',
        });

      expect(response.status).toBe(400);

      expect(response.body.success).toBe(false);
    });

    it('allows signup with phone and without email', async () => {
      const phone = uniquePhone('auth-phone-only');

      const signupResponse = await request(app).post('/auth/signup').send({
        firstName: 'Phone',
        lastName: 'Only',
        phone,
        password: 'StrongPassword123!',
        confirmPassword: 'StrongPassword123!',
        role: 'customer',
      });

      expect(signupResponse.status).toBe(201);

      expect(signupResponse.body.success).toBe(true);

      expect(signupResponse.body.data.contactType).toBe('phone');

      const signupId = signupResponse.body.data.signupId;

      const otp = otpProvider.getSmsOtp(phone);

      const verifyResponse = await request(app).post('/auth/signup/verify').send({
        signupId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      const userId = verifyResponse.body.data.userId;

      const userResult = await pool.query<{
        email: string | null;
        phone: string | null;
        phoneVerified: boolean;
      }>(
        `
                SELECT
                  email,
                  phone,
                  phone_verified AS "phoneVerified"
                FROM users
                WHERE id = $1
              `,
        [userId],
      );

      expect(userResult.rows).toHaveLength(1);

      const user = userResult.rows[0];

      expect(user).toBeDefined();

      if (!user) {
        throw new Error('Expected phone-only user');
      }

      expect(user.email).toBeNull();

      expect(user.phone).toBe(phone);

      expect(user.phoneVerified).toBe(true);

      await cleanupUser(userId);
    });
  });

  // ========================================================
  // Login
  // ========================================================

  describe('login', () => {
    it('returns a login challenge instead of issuing tokens before OTP verification', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-login');

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      expect(loginResponse.body.success).toBe(true);

      expect(loginResponse.body.data.challengeId).toEqual(expect.any(String));

      expect(loginResponse.body.data.expiresAt).toEqual(expect.any(String));

      expect(loginResponse.body.data.accessToken).toBeUndefined();

      expect(getSetCookieHeaders(loginResponse)).toHaveLength(0);

      expect(otpProvider.getSmsOtp(phone)).toMatch(/^\d{6}$/);

      await cleanupUser(userId);
    });

    it('completes login only after valid OTP verification', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-login-verify');

      const result = await loginVerifiedUser(email, phone);

      expect(result.accessToken).toEqual(expect.any(String));

      expect(result.refreshCookie).toContain(`${env.AUTH_REFRESH_COOKIE_NAME}=`);

      await cleanupUser(userId);
    });

    it('rejects an incorrect login OTP', async () => {
      const { userId, email } = await createVerifiedUser('auth-login-invalid-otp');

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const challengeId = loginResponse.body.data.challengeId;

      expect(challengeId).toEqual(expect.any(String));

      const verifyResponse = await request(app).post('/auth/login/verify').send({
        challengeId,
        otp: '000000',
      });

      expect(verifyResponse.status).toBe(400);

      expect(verifyResponse.body.success).toBe(false);

      expect(verifyResponse.body.data?.accessToken).toBeUndefined();

      await cleanupUser(userId);
    });

    it('rejects invalid credentials before sending an OTP', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: uniqueEmail('auth-invalid-login'),
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);

      expect(response.body.success).toBe(false);

      expect(response.body.data).toBeUndefined();
    });

    it('rejects a suspended account', async () => {
      const { userId, email } = await createVerifiedUser('auth-suspended');

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

      await cleanupUser(userId);
    });

    it('rejects a banned account', async () => {
      const { userId, email } = await createVerifiedUser('auth-banned');

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

      await cleanupUser(userId);
    });

    it('supports login using phone credentials', async () => {
      const { userId, phone } = await createVerifiedUser('auth-phone-login');

      const loginResponse = await request(app).post('/auth/login').send({
        phone,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      expect(loginResponse.body.success).toBe(true);

      expect(loginResponse.body.data.challengeId).toEqual(expect.any(String));

      const otp = otpProvider.getSmsOtp(phone);

      const verifyResponse = await request(app).post('/auth/login/verify').send({
        challengeId: loginResponse.body.data.challengeId,
        otp,
      });

      expect(verifyResponse.status).toBe(200);

      expect(verifyResponse.body.data.accessToken).toEqual(expect.any(String));

      expectRefreshCookie(verifyResponse);

      await cleanupUser(userId);
    });

    it('resends a login OTP after the cooldown has elapsed', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-login-resend');

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const challengeId = loginResponse.body.data.challengeId;

      expect(challengeId).toEqual(expect.any(String));

      await pool.query(
        `
              UPDATE login_challenges
              SET last_otp_sent_at =
                NOW() -
                ($2 * INTERVAL '1 second')
              WHERE id = $1
            `,
        [challengeId, env.AUTH_OTP_RESEND_COOLDOWN_SECONDS],
      );

      const resendResponse = await request(app).post('/auth/login/resend').send({
        challengeId,
      });

      expect(resendResponse.status).toBe(200);

      expect(resendResponse.body.success).toBe(true);

      expect(resendResponse.body.data.challengeId).toBe(challengeId);

      expect(resendResponse.body.data.expiresAt).toEqual(expect.any(String));

      const otp = otpProvider.getSmsOtp(phone);

      expect(otp).toBe('123456');

      await cleanupUser(userId);
    });

    it('rate-limits login OTP resend during the cooldown', async () => {
      const { userId, email } = await createVerifiedUser('auth-login-resend-cooldown');

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const challengeId = loginResponse.body.data.challengeId;

      const resendResponse = await request(app).post('/auth/login/resend').send({
        challengeId,
      });

      expect(resendResponse.status).toBe(429);

      expect(resendResponse.body.success).toBe(false);

      await cleanupUser(userId);
    });

    it('rejects login verification when the challenge has already been consumed', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-login-replay');

      const loginResponse = await request(app).post('/auth/login').send({
        email,
        password: 'StrongPassword123!',
      });

      expect(loginResponse.status).toBe(200);

      const challengeId = loginResponse.body.data.challengeId;

      const otp = otpProvider.getSmsOtp(phone);

      const firstVerify = await request(app).post('/auth/login/verify').send({
        challengeId,
        otp,
      });

      expect(firstVerify.status).toBe(200);

      const secondVerify = await request(app).post('/auth/login/verify').send({
        challengeId,
        otp,
      });

      expect(secondVerify.status).toBe(400);

      expect(secondVerify.body.success).toBe(false);

      await cleanupUser(userId);
    });
  });

  // ========================================================
  // Refresh
  // ========================================================

  describe('refresh', () => {
    it('refreshes and rotates the refresh token', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-refresh');

      const loginResult = await loginVerifiedUser(email, phone);

      const originalCookie = loginResult.refreshCookie;

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
        throw new Error('Expected original refresh token');
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

      await cleanupUser(userId);
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
      const { userId, email, phone } = await createVerifiedUser('auth-reuse');

      const loginResult = await loginVerifiedUser(email, phone);

      const originalCookie = loginResult.refreshCookie;

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
        throw new Error('Expected original refresh token');
      }

      const familyId = originalToken.familyId;

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
        [familyId],
      );

      expect(familyTokens.rows.length).toBeGreaterThanOrEqual(2);

      for (const token of familyTokens.rows) {
        expect(token.familyId).toBe(familyId);

        expect(token.revokedAt).toBeInstanceOf(Date);
      }

      await cleanupUser(userId);
    });

    it('uses the current database role during refresh', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-current-role');

      const loginResult = await loginVerifiedUser(email, phone);

      await pool.query(
        `
              UPDATE users
              SET role = 'admin'
              WHERE id = $1
            `,
        [userId],
      );

      const refreshResponse = await request(app)
        .post('/auth/refresh')
        .set('Cookie', loginResult.refreshCookie);

      expect(refreshResponse.status).toBe(200);

      expect(refreshResponse.body.success).toBe(true);

      expect(refreshResponse.body.data.accessToken).toEqual(expect.any(String));

      await cleanupUser(userId);
    });

    it('rejects refresh for a suspended account', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-refresh-suspended');

      const loginResult = await loginVerifiedUser(email, phone);

      await pool.query(
        `
              UPDATE users
              SET status = 'suspended'
              WHERE id = $1
            `,
        [userId],
      );

      const refreshResponse = await request(app)
        .post('/auth/refresh')
        .set('Cookie', loginResult.refreshCookie);

      expect(refreshResponse.status).toBe(401);

      expect(refreshResponse.body.success).toBe(false);

      await cleanupUser(userId);
    });

    it('rejects refresh for a banned account', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-refresh-banned');

      const loginResult = await loginVerifiedUser(email, phone);

      await pool.query(
        `
              UPDATE users
              SET status = 'banned'
              WHERE id = $1
            `,
        [userId],
      );

      const refreshResponse = await request(app)
        .post('/auth/refresh')
        .set('Cookie', loginResult.refreshCookie);

      expect(refreshResponse.status).toBe(401);

      expect(refreshResponse.body.success).toBe(false);

      await cleanupUser(userId);
    });
  });

  // ========================================================
  // Sessions
  // ========================================================

  describe('sessions', () => {
    it('lists only the authenticated user active sessions', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-sessions-list');

      const loginResult = await loginVerifiedUser(email, phone);

      const sessionResult = await pool.query<{
        id: string;
        userId: string;
        tokenHash: string;
        familyId: string;
        replacedBy: string | null;
        expiresAt: Date;
        revokedAt: Date | null;
      }>(
        `
                SELECT
                  id,
                  user_id AS "userId",
                  token_hash AS "tokenHash",
                  family_id AS "familyId",
                  replaced_by AS "replacedBy",
                  expires_at AS "expiresAt",
                  revoked_at AS "revokedAt"
                FROM refresh_tokens
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
              `,
        [userId],
      );

      expect(sessionResult.rows).toHaveLength(1);

      const session = sessionResult.rows[0];

      expect(session).toBeDefined();

      if (!session) {
        throw new Error('Expected refresh session');
      }

      const response = await request(app)
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${loginResult.accessToken}`);

      expect(response.status).toBe(200);

      expect(response.body.success).toBe(true);

      expect(response.body.data.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: session.id,
          }),
        ]),
      );

      const returnedSession = response.body.data.sessions.find(
        (item: { id: string }) => item.id === session.id,
      );

      expect(returnedSession).toBeDefined();

      expect(returnedSession).not.toHaveProperty('tokenHash');

      expect(returnedSession).not.toHaveProperty('token_hash');

      expect(returnedSession).not.toHaveProperty('familyId');

      expect(returnedSession).not.toHaveProperty('family_id');

      expect(returnedSession).not.toHaveProperty('userId');

      await cleanupUser(userId);
    });

    it('rejects unauthenticated session listing', async () => {
      const response = await request(app).get('/auth/sessions');

      expect(response.status).toBe(401);

      expect(response.body.success).toBe(false);
    });

    it('revokes only a session owned by the authenticated user', async () => {
      const firstUser = await createVerifiedUser('auth-session-owner');

      const secondUser = await createVerifiedUser('auth-session-other');

      const firstLogin = await loginVerifiedUser(firstUser.email, firstUser.phone);

      const secondLogin = await loginVerifiedUser(secondUser.email, secondUser.phone);

      const firstSessionResult = await pool.query<{
        id: string;
      }>(
        `
                SELECT id
                FROM refresh_tokens
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
              `,
        [firstUser.userId],
      );

      const secondSessionResult = await pool.query<{
        id: string;
      }>(
        `
                SELECT id
                FROM refresh_tokens
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
              `,
        [secondUser.userId],
      );

      expect(firstSessionResult.rows).toHaveLength(1);

      expect(secondSessionResult.rows).toHaveLength(1);

      const firstSession = firstSessionResult.rows[0];

      const secondSession = secondSessionResult.rows[0];

      expect(firstSession).toBeDefined();

      expect(secondSession).toBeDefined();

      if (!firstSession || !secondSession) {
        throw new Error('Expected both sessions');
      }

      const firstRevoke = await request(app)
        .delete(`/auth/sessions/${firstSession.id}`)
        .set('Authorization', `Bearer ${firstLogin.accessToken}`);

      expect(firstRevoke.status).toBe(204);

      const secondRevoke = await request(app)
        .delete(`/auth/sessions/${secondSession.id}`)
        .set('Authorization', `Bearer ${secondLogin.accessToken}`);

      expect(secondRevoke.status).toBe(204);

      await cleanupUser(firstUser.userId);

      await cleanupUser(secondUser.userId);
    });

    it('does not allow one user to revoke another user session', async () => {
      const owner = await createVerifiedUser('auth-session-isolation-owner');

      const attacker = await createVerifiedUser('auth-session-isolation-attacker');

      const attackerLogin = await loginVerifiedUser(attacker.email, attacker.phone);

      const ownerSessionResult = await pool.query<{
        id: string;
        revokedAt: Date | null;
      }>(
        `
                SELECT
                  id,
                  revoked_at AS "revokedAt"
                FROM refresh_tokens
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
              `,
        [owner.userId],
      );

      expect(ownerSessionResult.rows).toHaveLength(1);

      const ownerSession = ownerSessionResult.rows[0];

      expect(ownerSession).toBeDefined();

      if (!ownerSession) {
        throw new Error('Expected owner session');
      }

      const response = await request(app)
        .delete(`/auth/sessions/${ownerSession.id}`)
        .set('Authorization', `Bearer ${attackerLogin.accessToken}`);

      expect(response.status).toBe(404);

      const ownerAfter = await pool.query<{
        revokedAt: Date | null;
      }>(
        `
                SELECT
                  revoked_at AS "revokedAt"
                FROM refresh_tokens
                WHERE id = $1
              `,
        [ownerSession.id],
      );

      expect(ownerAfter.rows).toHaveLength(1);

      expect(ownerAfter.rows[0]).toBeDefined();

      if (!ownerAfter.rows[0]) {
        throw new Error('Expected owner session');
      }

      expect(ownerAfter.rows[0].revokedAt).toBeNull();

      await cleanupUser(owner.userId);

      await cleanupUser(attacker.userId);
    });

    it('returns 404 when revoking an already revoked session', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-session-repeat');

      const loginResult = await loginVerifiedUser(email, phone);

      const sessionResult = await pool.query<{
        id: string;
      }>(
        `
                SELECT id
                FROM refresh_tokens
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
              `,
        [userId],
      );

      expect(sessionResult.rows).toHaveLength(1);

      const session = sessionResult.rows[0];

      expect(session).toBeDefined();

      if (!session) {
        throw new Error('Expected session');
      }

      const firstResponse = await request(app)
        .delete(`/auth/sessions/${session.id}`)
        .set('Authorization', `Bearer ${loginResult.accessToken}`);

      expect(firstResponse.status).toBe(204);

      const secondResponse = await request(app)
        .delete(`/auth/sessions/${session.id}`)
        .set('Authorization', `Bearer ${loginResult.accessToken}`);

      expect(secondResponse.status).toBe(404);

      await cleanupUser(userId);
    });

    it('allows only one concurrent revoke for the same session', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-session-concurrency');

      const loginResult = await loginVerifiedUser(email, phone);

      const sessionResult = await pool.query<{
        id: string;
      }>(
        `
                SELECT id
                FROM refresh_tokens
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
              `,
        [userId],
      );

      expect(sessionResult.rows).toHaveLength(1);

      const session = sessionResult.rows[0];

      expect(session).toBeDefined();

      if (!session) {
        throw new Error('Expected session');
      }

      const [responseA, responseB] = await Promise.all([
        request(app)
          .delete(`/auth/sessions/${session.id}`)
          .set('Authorization', `Bearer ${loginResult.accessToken}`),

        request(app)
          .delete(`/auth/sessions/${session.id}`)
          .set('Authorization', `Bearer ${loginResult.accessToken}`),
      ]);

      const statuses = [responseA.status, responseB.status].sort((a, b) => a - b);

      expect(statuses).toEqual([204, 404]);

      await cleanupUser(userId);
    });

    it('removes a revoked session from the active session list', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-session-list-revoked');

      const loginResult = await loginVerifiedUser(email, phone);

      const sessionResult = await pool.query<{
        id: string;
      }>(
        `
                SELECT id
                FROM refresh_tokens
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
              `,
        [userId],
      );

      expect(sessionResult.rows).toHaveLength(1);

      const session = sessionResult.rows[0];

      expect(session).toBeDefined();

      if (!session) {
        throw new Error('Expected session');
      }

      const revokeResponse = await request(app)
        .delete(`/auth/sessions/${session.id}`)
        .set('Authorization', `Bearer ${loginResult.accessToken}`);

      expect(revokeResponse.status).toBe(204);

      const listResponse = await request(app)
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${loginResult.accessToken}`);

      expect(listResponse.status).toBe(200);

      expect(listResponse.body.success).toBe(true);

      const returnedIds = listResponse.body.data.sessions.map((item: { id: string }) => item.id);

      expect(returnedIds).not.toContain(session.id);

      await cleanupUser(userId);
    });
  });

  // ========================================================
  // Logout
  // ========================================================

  describe('logout', () => {
    it('logs out and revokes the refresh token', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-logout');

      const loginResult = await loginVerifiedUser(email, phone);

      const refreshCookie = loginResult.refreshCookie;

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
        throw new Error('Expected revoked token');
      }

      expect(revokedToken.revokedAt).toBeInstanceOf(Date);

      await cleanupUser(userId);
    });

    it('rejects logout without a refresh cookie', async () => {
      const response = await request(app).post('/auth/logout');

      expect(response.status).toBe(401);

      expect(response.body.success).toBe(false);
    });
  });

  // ========================================================
  // Cookie security
  // ========================================================

  describe('cookie security', () => {
    it('sets the refresh token as an HttpOnly cookie after OTP verification', async () => {
      const { userId, email, phone } = await createVerifiedUser('auth-cookie');

      const loginResult = await loginVerifiedUser(email, phone);

      const cookies = getSetCookieHeaders(loginResult.verifyResponse);

      const refreshCookie = cookies.find((cookie) =>
        cookie.startsWith(`${env.AUTH_REFRESH_COOKIE_NAME}=`),
      );

      expect(refreshCookie).toBeDefined();

      if (!refreshCookie) {
        throw new Error('Expected refresh cookie');
      }

      expect(refreshCookie).toContain('HttpOnly');

      expect(refreshCookie).toContain('SameSite');

      await cleanupUser(userId);
    });
  });

  // ========================================================
  // Cleanup
  // ========================================================

  afterAll(async () => {
    otpProvider.clear();
    await pool.end();
  });
});
