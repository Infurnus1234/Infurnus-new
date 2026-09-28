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
// TEST OTP PROVIDER
// ============================================================

interface TestOtpSession {
  channel: 'sms' | 'email';
  contact: string;
  otp: string;
  expiresAt: string;
  attemptsRemaining: number;
  verified: boolean;
}

class TestOtpProvider implements OtpProvider {
  private readonly sessions = new Map<string, TestOtpSession>();

  private readonly latestSessionByPhone = new Map<string, string>();

  private readonly latestSessionByEmail = new Map<string, string>();

  // ----------------------------------------------------------
  // Create OTP session
  // ----------------------------------------------------------

  private createSession(
    channel: 'sms' | 'email',
    contact: string,
  ): {
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  } {
    const sessionId = randomUUID();
    const sessionToken = randomUUID();

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const otp = '123456';

    this.sessions.set(sessionToken, {
      channel,
      contact,
      otp,
      expiresAt,
      attemptsRemaining: 5,
      verified: false,
    });

    if (channel === 'sms') {
      this.latestSessionByPhone.set(contact, sessionToken);
    } else {
      this.latestSessionByEmail.set(contact, sessionToken);
    }

    return {
      sessionId,
      sessionToken,
      expiresAt,
    };
  }

  // ----------------------------------------------------------
  // SMS OTP
  // ----------------------------------------------------------

  async sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    return this.createSession('sms', phone);
  }

  async verifySmsOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    return this.verifyOtp(sessionToken, otp, 'sms');
  }

  async resendSmsOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendOtp(sessionToken, 'sms');
  }

  // ----------------------------------------------------------
  // EMAIL OTP
  // ----------------------------------------------------------

  async sendEmailOtp(email: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    return this.createSession('email', email);
  }

  async verifyEmailOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    return this.verifyOtp(sessionToken, otp, 'email');
  }

  async resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendOtp(sessionToken, 'email');
  }

  // ----------------------------------------------------------
  // Verify OTP
  // ----------------------------------------------------------

  private verifyOtp(
    sessionToken: string,
    otp: string,
    expectedChannel: 'sms' | 'email',
  ): {
    verified: boolean;
    attemptsRemaining: number;
  } {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      throw new Error('Test OTP session not found');
    }

    if (session.channel !== expectedChannel) {
      throw new Error('Test OTP channel mismatch');
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

  // ----------------------------------------------------------
  // Resend OTP
  // ----------------------------------------------------------

  private resendOtp(
    sessionToken: string,
    expectedChannel: 'sms' | 'email',
  ): {
    expiresAt: string;
  } {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      throw new Error('Test OTP session not found');
    }

    if (session.channel !== expectedChannel) {
      throw new Error('Test OTP channel mismatch');
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

  // ----------------------------------------------------------
  // Test helpers
  // ----------------------------------------------------------

  getSmsOtp(phone: string): string {
    const sessionToken = this.latestSessionByPhone.get(phone);

    if (!sessionToken) {
      throw new Error(`No SMS OTP session for ${phone}`);
    }

    const session = this.sessions.get(sessionToken);

    if (!session) {
      throw new Error(`No SMS OTP found for ${phone}`);
    }

    return session.otp;
  }

  getEmailOtp(email: string): string {
    const sessionToken = this.latestSessionByEmail.get(email);

    if (!sessionToken) {
      throw new Error(`No email OTP session for ${email}`);
    }

    const session = this.sessions.get(sessionToken);

    if (!session) {
      throw new Error(`No email OTP found for ${email}`);
    }

    return session.otp;
  }

  clear(): void {
    this.sessions.clear();
    this.latestSessionByPhone.clear();
    this.latestSessionByEmail.clear();
  }
}

// ============================================================
// TEST HELPERS
// ============================================================

function uniqueEmail(prefix = 'auth'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

function uniquePhone(): string {
  const digits = randomUUID().replace(/\D/g, '').slice(0, 10).padEnd(10, '1');

  return `+91${digits}`;
}

// ============================================================
// COOKIE HELPERS
// ============================================================

function getSetCookieHeaders(response: Response): string[] {
  const cookies = response.headers['set-cookie'];

  if (Array.isArray(cookies)) {
    return cookies;
  }

  if (typeof cookies === 'string') {
    return [cookies];
  }

  return [];
}

function getRefreshCookie(response: Response): string {
  const prefix = `${env.AUTH_REFRESH_COOKIE_NAME}=`;

  const cookie = getSetCookieHeaders(response).find((value: string) => value.startsWith(prefix));

  if (!cookie) {
    throw new Error(`Refresh token cookie "${env.AUTH_REFRESH_COOKIE_NAME}" was not found`);
  }

  // IMPORTANT:
  // Explicitly check array element because
  // noUncheckedIndexedAccess may be enabled.
  const cookieValue = cookie.split(';', 1)[0];

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

// ============================================================
// AUTH INTEGRATION TESTS
// ============================================================

describe.sequential('Auth integration', () => {
  // IMPORTANT:
  // otpProvider is inside describe scope.
  // Cleanup is also inside describe scope.
  const otpProvider = new TestOtpProvider();

  const app = createApp(new PostgresUserRepository(pool), otpProvider, {
    enableAuthRateLimiting: false,
    enableAuthCsrfProtection: false,
  });

  // ========================================================
  // SETUP
  // ========================================================

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  // ========================================================
  // COMMON USER HELPER
  // ========================================================

  async function createVerifiedUser(prefix = 'auth-user'): Promise<{
    userId: string;
    email: string;
    phone: string;
  }> {
    const email = uniqueEmail(prefix);

    const phone = uniquePhone();

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Test',
      lastName: 'User',
      email,
      phone,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'customer',
    });

    expect(signupResponse.status).toBe(201);

    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    expect(signupId).toEqual(expect.any(String));

    // Both email and phone are supplied.
    // Current signup policy uses phone/SMS.
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

  // ========================================================
  // EMAIL LOGIN HELPER
  // ========================================================

  async function loginWithEmail(email: string): Promise<{
    accessToken: string;
    refreshCookie: string;
    challengeId: string;
  }> {
    const loginResponse = await request(app).post('/auth/login').send({
      email,
      password: 'StrongPassword123!',
    });

    expect(loginResponse.status).toBe(200);

    expect(loginResponse.body.success).toBe(true);

    const challengeId = loginResponse.body.data.challengeId;

    expect(challengeId).toEqual(expect.any(String));

    // EMAIL LOGIN -> EMAIL OTP
    const otp = otpProvider.getEmailOtp(email);

    const verifyResponse = await request(app).post('/auth/login/verify').send({
      challengeId,
      otp,
    });

    expect(verifyResponse.status).toBe(200);

    expect(verifyResponse.body.success).toBe(true);

    const accessToken = verifyResponse.body.data.accessToken;

    expect(accessToken).toEqual(expect.any(String));

    const refreshCookie = getRefreshCookie(verifyResponse);

    return {
      accessToken,
      refreshCookie,
      challengeId,
    };
  }

  // ========================================================
  // DATABASE CLEANUP
  // ========================================================

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

    // Driver profile belongs to the user.
    await pool.query(
      `
        DELETE FROM driver_profiles
        WHERE user_id = $1
      `,
      [userId],
    );

    // Partner belongs to the user.
    await pool.query(
      `
        DELETE FROM partners
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
  // 1. SIGNUP - EMAIL + PHONE
  // ========================================================

  it('signup: allows email and phone', async () => {
    const email = uniqueEmail('signup-both');

    const phone = uniquePhone();

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Both',
      lastName: 'Contact',
      email,
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

    expect(verifyResponse.body.success).toBe(true);

    const userId = verifyResponse.body.data.userId;

    const result = await pool.query<{
      email: string | null;
      phone: string | null;
      emailVerified: boolean;
      phoneVerified: boolean;
    }>(
      `
        SELECT
          email,
          phone,
          email_verified AS "emailVerified",
          phone_verified AS "phoneVerified"
        FROM users
        WHERE id = $1
      `,
      [userId],
    );

    expect(result.rows).toHaveLength(1);

    const user = result.rows[0];

    expect(user).toBeDefined();

    if (!user) {
      throw new Error('Expected user');
    }

    expect(user.email).toBe(email);

    expect(user.phone).toBe(phone);

    expect(user.phoneVerified).toBe(true);

    expect(user.emailVerified).toBe(false);

    await cleanupUser(userId);
  });

  // ========================================================
  // 2. EMAIL-ONLY SIGNUP
  // ========================================================

  it('signup: allows email without phone', async () => {
    const email = uniqueEmail('signup-email-only');

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Email',
      lastName: 'Only',
      email,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'customer',
    });

    expect(signupResponse.status).toBe(201);

    expect(signupResponse.body.data.contactType).toBe('email');

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getEmailOtp(email);

    expect(otp).toMatch(/^\d{6}$/);

    const verifyResponse = await request(app).post('/auth/signup/verify').send({
      signupId,
      otp,
    });

    expect(verifyResponse.status).toBe(200);

    const userId = verifyResponse.body.data.userId;

    const result = await pool.query<{
      email: string | null;
      phone: string | null;
      emailVerified: boolean;
      phoneVerified: boolean;
    }>(
      `
        SELECT
          email,
          phone,
          email_verified AS "emailVerified",
          phone_verified AS "phoneVerified"
        FROM users
        WHERE id = $1
      `,
      [userId],
    );

    expect(result.rows).toHaveLength(1);

    const user = result.rows[0];

    expect(user).toBeDefined();

    if (!user) {
      throw new Error('Expected email-only user');
    }

    expect(user.email).toBe(email);

    expect(user.phone).toBeNull();

    expect(user.emailVerified).toBe(true);

    expect(user.phoneVerified).toBe(false);

    await cleanupUser(userId);
  });

  // ========================================================
  // 3. PHONE-ONLY SIGNUP
  // ========================================================

  it('signup: allows phone without email', async () => {
    const phone = uniquePhone();

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Phone',
      lastName: 'Only',
      phone,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'customer',
    });

    expect(signupResponse.status).toBe(201);

    expect(signupResponse.body.data.contactType).toBe('phone');

    const signupId = signupResponse.body.data.signupId;

    const otp = otpProvider.getSmsOtp(phone);

    const verifyResponse = await request(app).post('/auth/signup/verify').send({
      signupId,
      otp,
    });

    expect(verifyResponse.status).toBe(200);

    const userId = verifyResponse.body.data.userId;

    const result = await pool.query<{
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

    const user = result.rows[0];

    expect(user).toBeDefined();

    if (!user) {
      throw new Error('Expected phone-only user');
    }

    expect(user.email).toBeNull();

    expect(user.phone).toBe(phone);

    expect(user.phoneVerified).toBe(true);

    await cleanupUser(userId);
  });

  // ========================================================
  // 4. DRIVER SIGNUP
  // ========================================================

  it('signup: creates driver profile for driver role', async () => {
    const email = uniqueEmail('driver-signup');

    const phone = uniquePhone();

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Driver',
      lastName: 'Test',
      email,
      phone,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'driver',
      licenseNumber: 'DL-TEST-12345',
      licenseExpiry: '2030-12-31',
    });

    expect(signupResponse.status).toBe(201);

    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    expect(signupId).toEqual(expect.any(String));

    const otp = otpProvider.getSmsOtp(phone);

    const verifyResponse = await request(app).post('/auth/signup/verify').send({
      signupId,
      otp,
    });

    expect(verifyResponse.status).toBe(200);

    expect(verifyResponse.body.success).toBe(true);

    const userId = verifyResponse.body.data.userId;

    const userResult = await pool.query<{
      role: string;
      status: string;
    }>(
      `
        SELECT
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
      throw new Error('Expected driver user');
    }

    expect(user.role).toBe('driver');

    expect(user.status).toBe('active');

    const driverResult = await pool.query<{
      userId: string;
      licenseNumber: string;
      licenseExpiry: string;
      verificationStatus: string;
    }>(
      `
        SELECT
          user_id AS "userId",
          license_number AS "licenseNumber",
          license_expiry::text AS "licenseExpiry",
          verification_status AS "verificationStatus"
        FROM driver_profiles
        WHERE user_id = $1
      `,
      [userId],
    );

    expect(driverResult.rows).toHaveLength(1);

    const driver = driverResult.rows[0];

    expect(driver).toBeDefined();

    if (!driver) {
      throw new Error('Expected driver profile');
    }

    expect(driver.userId).toBe(userId);

    expect(driver.licenseNumber).toBe('DL-TEST-12345');

    expect(driver.licenseExpiry).toBe('2030-12-31');

    expect(driver.verificationStatus).toBe('pending');

    await cleanupUser(userId);
  });

  // ========================================================
  // 5. FLEET OWNER SIGNUP
  // ========================================================

  it('signup: creates partner profile for fleet owner role', async () => {
    const email = uniqueEmail('fleet-owner-signup');

    const phone = uniquePhone();

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Fleet',
      lastName: 'Owner',
      email,
      phone,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'fleet_owner',
      businessName: 'Test Fleet Pvt Ltd',
    });

    expect(signupResponse.status).toBe(201);

    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    expect(signupId).toEqual(expect.any(String));

    const otp = otpProvider.getSmsOtp(phone);

    const verifyResponse = await request(app).post('/auth/signup/verify').send({
      signupId,
      otp,
    });

    expect(verifyResponse.status).toBe(200);

    expect(verifyResponse.body.success).toBe(true);

    const userId = verifyResponse.body.data.userId;

    const userResult = await pool.query<{
      role: string;
      status: string;
    }>(
      `
        SELECT
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
      throw new Error('Expected fleet owner user');
    }

    expect(user.role).toBe('fleet_owner');

    expect(user.status).toBe('active');

    const partnerResult = await pool.query<{
      userId: string;
      businessName: string;
      approvalStatus: string;
    }>(
      `
        SELECT
          user_id AS "userId",
          business_name AS "businessName",
          approval_status AS "approvalStatus"
        FROM partners
        WHERE user_id = $1
      `,
      [userId],
    );

    expect(partnerResult.rows).toHaveLength(1);

    const partner = partnerResult.rows[0];

    expect(partner).toBeDefined();

    if (!partner) {
      throw new Error('Expected partner profile');
    }

    expect(partner.userId).toBe(userId);

    expect(partner.businessName).toBe('Test Fleet Pvt Ltd');

    expect(partner.approvalStatus).toBe('pending');

    await cleanupUser(userId);
  });

  // ========================================================
  // 6. DRIVER + FLEET OWNER SIGNUP
  // ========================================================

  it('signup: creates driver profile and partner profile for driver_fleet_owner role', async () => {
    const email = uniqueEmail('driver-fleet-signup');

    const phone = uniquePhone();

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Driver',
      lastName: 'FleetOwner',
      email,
      phone,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'driver_fleet_owner',
      licenseNumber: 'DL-FLEET-12345',
      licenseExpiry: '2031-06-30',
      businessName: 'Driver Fleet Test Pvt Ltd',
    });

    expect(signupResponse.status).toBe(201);

    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    expect(signupId).toEqual(expect.any(String));

    const otp = otpProvider.getSmsOtp(phone);

    const verifyResponse = await request(app).post('/auth/signup/verify').send({
      signupId,
      otp,
    });

    expect(verifyResponse.status).toBe(200);

    expect(verifyResponse.body.success).toBe(true);

    const userId = verifyResponse.body.data.userId;

    const userResult = await pool.query<{
      role: string;
      status: string;
    }>(
      `
        SELECT
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
      throw new Error('Expected driver fleet owner user');
    }

    expect(user.role).toBe('driver_fleet_owner');

    expect(user.status).toBe('active');

    const driverResult = await pool.query<{
      userId: string;
      licenseNumber: string;
      licenseExpiry: string;
      verificationStatus: string;
    }>(
      `
        SELECT
          user_id AS "userId",
          license_number AS "licenseNumber",
          license_expiry::text AS "licenseExpiry",
          verification_status AS "verificationStatus"
        FROM driver_profiles
        WHERE user_id = $1
      `,
      [userId],
    );

    expect(driverResult.rows).toHaveLength(1);

    const driver = driverResult.rows[0];

    expect(driver).toBeDefined();

    if (!driver) {
      throw new Error('Expected driver profile');
    }

    expect(driver.userId).toBe(userId);

    expect(driver.licenseNumber).toBe('DL-FLEET-12345');

    expect(driver.licenseExpiry).toBe('2031-06-30');

    expect(driver.verificationStatus).toBe('pending');

    const partnerResult = await pool.query<{
      userId: string;
      businessName: string;
      approvalStatus: string;
    }>(
      `
        SELECT
          user_id AS "userId",
          business_name AS "businessName",
          approval_status AS "approvalStatus"
        FROM partners
        WHERE user_id = $1
      `,
      [userId],
    );

    expect(partnerResult.rows).toHaveLength(1);

    const partner = partnerResult.rows[0];

    expect(partner).toBeDefined();

    if (!partner) {
      throw new Error('Expected partner profile');
    }

    expect(partner.userId).toBe(userId);

    expect(partner.businessName).toBe('Driver Fleet Test Pvt Ltd');

    expect(partner.approvalStatus).toBe('pending');

    await cleanupUser(userId);
  });

  // ========================================================
  // 7. SIGNUP WITHOUT CONTACT
  // ========================================================

  it('signup: rejects missing email and phone', async () => {
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

  // ========================================================
  // 8A. SIGNUP VALIDATION - INVALID PHONE
  // ========================================================

  it('signup: rejects invalid phone number', async () => {
    const response = await request(app).post('/auth/signup').send({
      firstName: 'Invalid',
      lastName: 'Phone',
      phone: '123',
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'customer',
    });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 8B. SIGNUP VALIDATION - INVALID LICENSE DATE
  // ========================================================

  it('signup: rejects invalid license calendar date', async () => {
    const response = await request(app).post('/auth/signup').send({
      firstName: 'Invalid',
      lastName: 'Date',
      phone: uniquePhone(),
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'driver',
      licenseNumber: 'DL-INVALID-DATE',
      licenseExpiry: '2030-02-30',
    });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 8C. SIGNUP VALIDATION - DRIVER WITHOUT LICENSE
  // ========================================================

  it('signup: rejects driver without license number', async () => {
    const response = await request(app).post('/auth/signup').send({
      firstName: 'Driver',
      lastName: 'NoLicense',
      phone: uniquePhone(),
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'driver',
      licenseExpiry: '2030-12-31',
    });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  it('signup: rejects driver without license expiry', async () => {
    const response = await request(app).post('/auth/signup').send({
      firstName: 'Driver',
      lastName: 'NoExpiry',
      phone: uniquePhone(),
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'driver',
      licenseNumber: 'DL-NO-EXPIRY',
    });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 8D. SIGNUP VALIDATION - FLEET OWNER WITHOUT BUSINESS
  // ========================================================

  it('signup: rejects fleet owner without business name', async () => {
    const response = await request(app).post('/auth/signup').send({
      firstName: 'Fleet',
      lastName: 'NoBusiness',
      phone: uniquePhone(),
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'fleet_owner',
    });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 8E. SIGNUP VALIDATION - PASSWORD MISMATCH
  // ========================================================

  it('signup: rejects password mismatch', async () => {
    const response = await request(app).post('/auth/signup').send({
      firstName: 'Password',
      lastName: 'Mismatch',
      phone: uniquePhone(),
      password: 'StrongPassword123!',
      confirmPassword: 'DifferentPassword123!',
      role: 'customer',
    });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 8F. SIGNUP VALIDATION - UNKNOWN FIELD
  // ========================================================

  it('signup: rejects unknown fields', async () => {
    const response = await request(app).post('/auth/signup').send({
      firstName: 'Unknown',
      lastName: 'Field',
      phone: uniquePhone(),
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'customer',
      unexpectedField: 'should-not-be-accepted',
    });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 8G. SIGNUP VALIDATION - INVALID ROLE
  // ========================================================

  it('signup: rejects invalid role', async () => {
    const response = await request(app).post('/auth/signup').send({
      firstName: 'Invalid',
      lastName: 'Role',
      phone: uniquePhone(),
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'admin',
    });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 9. INVALID SIGNUP OTP
  // ========================================================

  it('signup: rejects incorrect OTP', async () => {
    const email = uniqueEmail('signup-invalid-otp');

    const phone = uniquePhone();

    const response = await request(app).post('/auth/signup').send({
      firstName: 'Invalid',
      lastName: 'OTP',
      email,
      phone,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      role: 'customer',
    });

    expect(response.status).toBe(201);

    const signupId = response.body.data.signupId;

    const verification = await request(app).post('/auth/signup/verify').send({
      signupId,
      otp: '000000',
    });

    expect(verification.status).toBe(400);

    expect(verification.body.success).toBe(false);

    await cleanupSignup(signupId);
  });

  // ========================================================
  // 10. EMAIL LOGIN
  // ========================================================

  it('login: email uses email OTP', async () => {
    const user = await createVerifiedUser('email-login');

    const login = await request(app).post('/auth/login').send({
      email: user.email,
      password: 'StrongPassword123!',
    });

    expect(login.status).toBe(200);

    expect(login.body.success).toBe(true);

    const challengeId = login.body.data.challengeId;

    expect(challengeId).toEqual(expect.any(String));

    const otp = otpProvider.getEmailOtp(user.email);

    const verification = await request(app).post('/auth/login/verify').send({
      challengeId,
      otp,
    });

    expect(verification.status).toBe(200);

    expect(verification.body.data.accessToken).toEqual(expect.any(String));

    expect(getRefreshCookie(verification)).toContain(`${env.AUTH_REFRESH_COOKIE_NAME}=`);

    await cleanupUser(user.userId);
  });

  // ========================================================
  // 11. PHONE LOGIN
  // ========================================================

  it('login: phone uses SMS OTP', async () => {
    const user = await createVerifiedUser('phone-login');

    const login = await request(app).post('/auth/login').send({
      phone: user.phone,
      password: 'StrongPassword123!',
    });

    expect(login.status).toBe(200);

    const challengeId = login.body.data.challengeId;

    expect(challengeId).toEqual(expect.any(String));

    const otp = otpProvider.getSmsOtp(user.phone);

    const verification = await request(app).post('/auth/login/verify').send({
      challengeId,
      otp,
    });

    expect(verification.status).toBe(200);

    expect(verification.body.data.accessToken).toEqual(expect.any(String));

    await cleanupUser(user.userId);
  });

  // ========================================================
  // 12. INVALID LOGIN OTP
  // ========================================================

  it('login: rejects incorrect OTP', async () => {
    const user = await createVerifiedUser('invalid-login-otp');

    const login = await request(app).post('/auth/login').send({
      email: user.email,
      password: 'StrongPassword123!',
    });

    expect(login.status).toBe(200);

    const verification = await request(app).post('/auth/login/verify').send({
      challengeId: login.body.data.challengeId,
      otp: '000000',
    });

    expect(verification.status).toBe(400);

    expect(verification.body.success).toBe(false);

    expect(verification.body.data?.accessToken).toBeUndefined();

    await cleanupUser(user.userId);
  });

  // ========================================================
  // 13. INVALID LOGIN CREDENTIALS
  // ========================================================

  it('login: rejects invalid credentials', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({
        email: uniqueEmail('invalid-credentials'),
        password: 'WrongPassword123!',
      });

    expect(response.status).toBe(401);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 14. REFRESH TOKEN ROTATION
  // ========================================================

  it('refresh: rotates refresh token', async () => {
    const user = await createVerifiedUser('refresh');

    const login = await loginWithEmail(user.email);

    const oldCookie = login.refreshCookie;

    const oldToken = getRefreshTokenFromCookie(oldCookie);

    const refresh = await request(app).post('/auth/refresh').set('Cookie', oldCookie);

    expect(refresh.status).toBe(200);

    expect(refresh.body.success).toBe(true);

    expect(refresh.body.data.accessToken).toEqual(expect.any(String));

    const newCookie = getRefreshCookie(refresh);

    const newToken = getRefreshTokenFromCookie(newCookie);

    expect(newToken).not.toBe(oldToken);

    const result = await pool.query<{
      tokenHash: string;
      revokedAt: Date | null;
      replacedBy: string | null;
    }>(
      `
        SELECT
          token_hash AS "tokenHash",
          revoked_at AS "revokedAt",
          replaced_by AS "replacedBy"
        FROM refresh_tokens
        WHERE token_hash = $1
      `,
      [hashRefreshToken(oldToken)],
    );

    expect(result.rows).toHaveLength(1);

    const oldRow = result.rows[0];

    expect(oldRow).toBeDefined();

    if (!oldRow) {
      throw new Error('Expected old refresh token');
    }

    expect(oldRow.revokedAt).toBeInstanceOf(Date);

    expect(oldRow.replacedBy).toEqual(expect.any(String));

    await cleanupUser(user.userId);
  });

  // ========================================================
  // 15. REFRESH WITHOUT COOKIE
  // ========================================================

  it('refresh: rejects missing cookie', async () => {
    const response = await request(app).post('/auth/refresh');

    expect(response.status).toBe(401);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // 16. REFRESH TOKEN REUSE
  // ========================================================

  it('refresh: detects rotated token reuse', async () => {
    const user = await createVerifiedUser('refresh-reuse');

    const login = await loginWithEmail(user.email);

    const oldCookie = login.refreshCookie;

    const firstRefresh = await request(app).post('/auth/refresh').set('Cookie', oldCookie);

    expect(firstRefresh.status).toBe(200);

    const reuse = await request(app).post('/auth/refresh').set('Cookie', oldCookie);

    expect(reuse.status).toBe(401);

    expect(reuse.body.success).toBe(false);

    await cleanupUser(user.userId);
  });

  // ========================================================
  // 17. SESSION LIST
  // ========================================================

  it('sessions: lists authenticated sessions', async () => {
    const user = await createVerifiedUser('sessions');

    const login = await loginWithEmail(user.email);

    const response = await request(app)
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${login.accessToken}`);

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.data.sessions).toEqual(expect.any(Array));

    expect(response.body.data.sessions.length).toBeGreaterThan(0);

    const session = response.body.data.sessions[0];

    expect(session).toBeDefined();

    if (!session) {
      throw new Error('Expected session');
    }

    // Sensitive information must not
    // be returned to the client.
    expect(session).not.toHaveProperty('tokenHash');

    expect(session).not.toHaveProperty('token_hash');

    expect(session).not.toHaveProperty('familyId');

    expect(session).not.toHaveProperty('family_id');

    await cleanupUser(user.userId);
  });

  // ========================================================
  // 18. LOGOUT
  // ========================================================

  it('logout: revokes refresh token', async () => {
    const user = await createVerifiedUser('logout');

    const login = await loginWithEmail(user.email);

    const logout = await request(app).post('/auth/logout').set('Cookie', login.refreshCookie);

    expect(logout.status).toBe(204);

    const refresh = await request(app).post('/auth/refresh').set('Cookie', login.refreshCookie);

    expect(refresh.status).toBe(401);

    expect(refresh.body.success).toBe(false);

    await cleanupUser(user.userId);
  });

  // ========================================================
  // 19. LOGOUT WITHOUT COOKIE
  // ========================================================

  it('logout: rejects missing refresh cookie', async () => {
    const response = await request(app).post('/auth/logout');

    expect(response.status).toBe(401);

    expect(response.body.success).toBe(false);
  });

  // ========================================================
  // CLEANUP
  // ========================================================

  afterAll(async () => {
    otpProvider.clear();

    await pool.end();
  });
});
