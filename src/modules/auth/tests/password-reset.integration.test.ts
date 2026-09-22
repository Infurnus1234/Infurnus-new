import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../../app.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';

import type { OtpProvider } from '../providers/otp.provider.js';

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

  private readonly latestSessionByEmail = new Map<string, string>();

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

    this.sessions.set(sessionToken, {
      channel,
      contact,
      otp: '123456',
      expiresAt,
      attemptsRemaining: 5,
      verified: false,
    });

    if (channel === 'email') {
      this.latestSessionByEmail.set(contact, sessionToken);
    }

    return {
      sessionId,
      sessionToken,
      expiresAt,
    };
  }

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
    this.latestSessionByEmail.clear();
  }
}

// ============================================================
// TEST HELPERS
// ============================================================

function uniqueEmail(prefix = 'password-reset'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

const ORIGINAL_PASSWORD = 'StrongPassword123!';
const NEW_PASSWORD = 'NewStrongPassword456!';

// ============================================================
// PASSWORD RESET INTEGRATION TESTS
// ============================================================

describe.sequential('Password reset integration', () => {
  const otpProvider = new TestOtpProvider();

  const app = createApp(new PostgresUserRepository(pool), otpProvider, {
    enableAuthRateLimiting: false,
    enableAuthCsrfProtection: false,
  });

  // ==========================================================
  // SETUP
  // ==========================================================

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  // ==========================================================
  // HELPERS
  // ==========================================================

  async function createVerifiedUser(prefix = 'password-reset-user'): Promise<{
    userId: string;
    email: string;
  }> {
    const email = uniqueEmail(prefix);
    const phone = `+91${randomUUID().replace(/\D/g, '').slice(0, 10).padEnd(10, '1')}`;

    const signupResponse = await request(app).post('/auth/signup').send({
      firstName: 'Reset',
      lastName: 'User',
      email,
      phone,
      password: ORIGINAL_PASSWORD,
      confirmPassword: ORIGINAL_PASSWORD,
      role: 'customer',
    });

    expect(signupResponse.status).toBe(201);
    expect(signupResponse.body.success).toBe(true);

    const signupId = signupResponse.body.data.signupId;

    const signupOtp = '123456';

    const verifyResponse = await request(app).post('/auth/signup/verify').send({
      signupId,
      otp: signupOtp,
    });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.success).toBe(true);

    return {
      userId: verifyResponse.body.data.userId,
      email,
    };
  }

  async function cleanupUser(userId: string): Promise<void> {
    await pool.query(
      `
        DELETE FROM password_reset_challenges
        WHERE user_id = $1
      `,
      [userId],
    );

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

  async function requestPasswordReset(email: string): Promise<{
    resetSessionToken: string;
    expiresAt: string;
  }> {
    const response = await request(app).post('/auth/forgot-password').send({
      email,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.message).toBe(
      'If an account exists for this email address, a password reset code has been sent.',
    );

    expect(response.body.data.resetSessionToken).toEqual(expect.any(String));

    expect(response.body.data.expiresAt).toEqual(expect.any(String));

    return {
      resetSessionToken: response.body.data.resetSessionToken,
      expiresAt: response.body.data.expiresAt,
    };
  }

  // ==========================================================
  // 1. FORGOT PASSWORD - REGISTERED EMAIL
  // ==========================================================

  it('forgot-password: sends reset OTP for registered email', async () => {
    const user = await createVerifiedUser('forgot-registered');

    try {
      const response = await request(app).post('/auth/forgot-password').send({
        email: user.email,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(response.body.data.message).toBe(
        'If an account exists for this email address, a password reset code has been sent.',
      );

      expect(response.body.data.resetSessionToken).toEqual(expect.any(String));

      expect(response.body.data.expiresAt).toEqual(expect.any(String));

      expect(otpProvider.getEmailOtp(user.email)).toBe('123456');

      const challenge = await pool.query<{
        userId: string;
        email: string;
        providerSessionId: string;
        providerSessionTokenEncrypted: string;
        verifiedAt: Date | null;
        consumedAt: Date | null;
      }>(
        `
          SELECT
            user_id AS "userId",
            email,
            provider_session_id AS "providerSessionId",
            provider_session_token_encrypted
              AS "providerSessionTokenEncrypted",
            verified_at AS "verifiedAt",
            consumed_at AS "consumedAt"
          FROM password_reset_challenges
          WHERE user_id = $1
          LIMIT 1
        `,
        [user.userId],
      );

      expect(challenge.rows).toHaveLength(1);

      const row = challenge.rows[0];

      expect(row).toBeDefined();

      if (!row) {
        throw new Error('Expected password reset challenge');
      }

      expect(row.userId).toBe(user.userId);
      expect(row.email).toBe(user.email);
      expect(row.providerSessionId).toEqual(expect.any(String));
      expect(row.providerSessionTokenEncrypted).toEqual(expect.any(String));
      expect(row.providerSessionTokenEncrypted).not.toBe('123456');
      expect(row.verifiedAt).toBeNull();
      expect(row.consumedAt).toBeNull();
    } finally {
      await cleanupUser(user.userId);
    }
  });

  // ==========================================================
  // 2. FORGOT PASSWORD - UNKNOWN EMAIL
  // ==========================================================

  it('forgot-password: returns generic response for unknown email', async () => {
    const email = uniqueEmail('forgot-unknown');

    const response = await request(app).post('/auth/forgot-password').send({
      email,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.message).toBe(
      'If an account exists for this email address, a password reset code has been sent.',
    );

    expect(response.body.data.resetSessionToken).toEqual(expect.any(String));

    expect(response.body.data.expiresAt).toEqual(expect.any(String));

    const challengeCount = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM password_reset_challenges
        WHERE email = $1
      `,
      [email],
    );

    expect(challengeCount.rows[0]?.count).toBe('0');
  });

  // ==========================================================
  // 3. OTP VERIFICATION - SUCCESS
  // ==========================================================

  it('forgot-password: verifies correct OTP', async () => {
    const user = await createVerifiedUser('forgot-verify-success');

    try {
      const reset = await requestPasswordReset(user.email);

      const otp = otpProvider.getEmailOtp(user.email);

      const response = await request(app).post('/auth/forgot-password/verify').send({
        resetSessionToken: reset.resetSessionToken,
        otp,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.verified).toBe(true);

      const challenge = await pool.query<{
        verifiedAt: Date | null;
      }>(
        `
          SELECT verified_at AS "verifiedAt"
          FROM password_reset_challenges
          WHERE user_id = $1
          LIMIT 1
        `,
        [user.userId],
      );

      expect(challenge.rows[0]?.verifiedAt).toBeInstanceOf(Date);
    } finally {
      await cleanupUser(user.userId);
    }
  });

  // ==========================================================
  // 4. OTP VERIFICATION - INVALID OTP
  // ==========================================================

  it('forgot-password: rejects incorrect OTP', async () => {
    const user = await createVerifiedUser('forgot-invalid-otp');

    try {
      const reset = await requestPasswordReset(user.email);

      const response = await request(app).post('/auth/forgot-password/verify').send({
        resetSessionToken: reset.resetSessionToken,
        otp: '000000',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.data?.verified).not.toBe(true);
    } finally {
      await cleanupUser(user.userId);
    }
  });

  // ==========================================================
  // 5. INVALID RESET SESSION
  // ==========================================================

  it('forgot-password: rejects invalid reset session token', async () => {
    const response = await request(app)
      .post('/auth/forgot-password/verify')
      .send({
        resetSessionToken: 'a'.repeat(64),
        otp: '123456',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  // ==========================================================
  // 6. RESET WITHOUT OTP VERIFICATION
  // ==========================================================

  it('reset-password: rejects unverified reset session', async () => {
    const user = await createVerifiedUser('reset-unverified');

    try {
      const reset = await requestPasswordReset(user.email);

      const response = await request(app).post('/auth/reset-password').send({
        resetSessionToken: reset.resetSessionToken,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    } finally {
      await cleanupUser(user.userId);
    }
  });

  // ==========================================================
  // 7. PASSWORD MISMATCH
  // ==========================================================

  it('reset-password: rejects mismatched passwords', async () => {
    const response = await request(app)
      .post('/auth/reset-password')
      .send({
        resetSessionToken: 'a'.repeat(64),
        password: NEW_PASSWORD,
        confirmPassword: 'DifferentPassword789!',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  // ==========================================================
  // 8. PASSWORD TOO SHORT
  // ==========================================================

  it('reset-password: rejects password shorter than 8 characters', async () => {
    const response = await request(app)
      .post('/auth/reset-password')
      .send({
        resetSessionToken: 'a'.repeat(64),
        password: 'short',
        confirmPassword: 'short',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  // ==========================================================
  // 9. SUCCESSFUL PASSWORD RESET
  // ==========================================================

  it('reset-password: updates password after OTP verification', async () => {
    const user = await createVerifiedUser('reset-success');

    try {
      const reset = await requestPasswordReset(user.email);

      const otp = otpProvider.getEmailOtp(user.email);

      const verification = await request(app).post('/auth/forgot-password/verify').send({
        resetSessionToken: reset.resetSessionToken,
        otp,
      });

      expect(verification.status).toBe(200);
      expect(verification.body.success).toBe(true);

      const resetResponse = await request(app).post('/auth/reset-password').send({
        resetSessionToken: reset.resetSessionToken,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

      expect(resetResponse.status).toBe(200);
      expect(resetResponse.body.success).toBe(true);

      const credentials = await pool.query<{
        passwordHash: string;
      }>(
        `
          SELECT password_hash AS "passwordHash"
          FROM user_credentials
          WHERE user_id = $1
        `,
        [user.userId],
      );

      expect(credentials.rows).toHaveLength(1);
      expect(credentials.rows[0]?.passwordHash).toEqual(expect.any(String));

      const loginWithOldPassword = await request(app).post('/auth/login').send({
        email: user.email,
        password: ORIGINAL_PASSWORD,
      });

      expect(loginWithOldPassword.status).toBe(401);

      const loginWithNewPassword = await request(app).post('/auth/login').send({
        email: user.email,
        password: NEW_PASSWORD,
      });

      expect(loginWithNewPassword.status).toBe(200);
      expect(loginWithNewPassword.body.success).toBe(true);
    } finally {
      await cleanupUser(user.userId);
    }
  });

  // ==========================================================
  // 10. RESET SESSION IS CONSUMED
  // ==========================================================

  it('reset-password: prevents reset session reuse', async () => {
    const user = await createVerifiedUser('reset-reuse');

    try {
      const reset = await requestPasswordReset(user.email);

      const otp = otpProvider.getEmailOtp(user.email);

      const verification = await request(app).post('/auth/forgot-password/verify').send({
        resetSessionToken: reset.resetSessionToken,
        otp,
      });

      expect(verification.status).toBe(200);

      const firstReset = await request(app).post('/auth/reset-password').send({
        resetSessionToken: reset.resetSessionToken,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

      expect(firstReset.status).toBe(200);
      expect(firstReset.body.success).toBe(true);

      const secondReset = await request(app).post('/auth/reset-password').send({
        resetSessionToken: reset.resetSessionToken,
        password: 'AnotherPassword789!',
        confirmPassword: 'AnotherPassword789!',
      });

      expect(secondReset.status).toBe(400);
      expect(secondReset.body.success).toBe(false);

      const challenge = await pool.query<{
        consumedAt: Date | null;
      }>(
        `
          SELECT consumed_at AS "consumedAt"
          FROM password_reset_challenges
          WHERE user_id = $1
          LIMIT 1
        `,
        [user.userId],
      );

      expect(challenge.rows[0]?.consumedAt).toBeInstanceOf(Date);
    } finally {
      await cleanupUser(user.userId);
    }
  });

  // ==========================================================
  // 11. ALL REFRESH SESSIONS ARE REVOKED
  // ==========================================================

  it('reset-password: revokes all refresh sessions', async () => {
    const user = await createVerifiedUser('reset-revoke-sessions');

    try {
      const loginOne = await request(app).post('/auth/login').send({
        email: user.email,
        password: ORIGINAL_PASSWORD,
      });

      expect(loginOne.status).toBe(200);

      const otpOne = otpProvider.getEmailOtp(user.email);

      const verifyOne = await request(app).post('/auth/login/verify').send({
        challengeId: loginOne.body.data.challengeId,
        otp: otpOne,
      });

      expect(verifyOne.status).toBe(200);

      const loginTwo = await request(app).post('/auth/login').send({
        email: user.email,
        password: ORIGINAL_PASSWORD,
      });

      expect(loginTwo.status).toBe(200);

      const otpTwo = otpProvider.getEmailOtp(user.email);

      const verifyTwo = await request(app).post('/auth/login/verify').send({
        challengeId: loginTwo.body.data.challengeId,
        otp: otpTwo,
      });

      expect(verifyTwo.status).toBe(200);

      const reset = await requestPasswordReset(user.email);

      const resetOtp = otpProvider.getEmailOtp(user.email);

      const resetVerification = await request(app).post('/auth/forgot-password/verify').send({
        resetSessionToken: reset.resetSessionToken,
        otp: resetOtp,
      });

      expect(resetVerification.status).toBe(200);

      const resetResponse = await request(app).post('/auth/reset-password').send({
        resetSessionToken: reset.resetSessionToken,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

      expect(resetResponse.status).toBe(200);

      const sessions = await pool.query<{
        revokedAt: Date | null;
      }>(
        `
          SELECT revoked_at AS "revokedAt"
          FROM refresh_tokens
          WHERE user_id = $1
        `,
        [user.userId],
      );

      expect(sessions.rows.length).toBeGreaterThanOrEqual(2);

      for (const session of sessions.rows) {
        expect(session.revokedAt).toBeInstanceOf(Date);
      }
    } finally {
      await cleanupUser(user.userId);
    }
  });

  // ==========================================================
  // 12. REPEATED FORGOT PASSWORD REPLACES ACTIVE CHALLENGE
  // ==========================================================

  it('forgot-password: replaces previous active reset challenge', async () => {
    const user = await createVerifiedUser('forgot-replace');

    try {
      const first = await requestPasswordReset(user.email);

      const firstToken = first.resetSessionToken;

      const second = await requestPasswordReset(user.email);

      const secondToken = second.resetSessionToken;

      expect(secondToken).not.toBe(firstToken);

      const challengeCount = await pool.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM password_reset_challenges
          WHERE user_id = $1
            AND consumed_at IS NULL
        `,
        [user.userId],
      );

      expect(challengeCount.rows[0]?.count).toBe('1');

      const oldSessionVerification = await request(app).post('/auth/forgot-password/verify').send({
        resetSessionToken: firstToken,
        otp: '123456',
      });

      expect(oldSessionVerification.status).toBe(400);

      const newSessionVerification = await request(app).post('/auth/forgot-password/verify').send({
        resetSessionToken: secondToken,
        otp: '123456',
      });

      expect(newSessionVerification.status).toBe(200);
      expect(newSessionVerification.body.success).toBe(true);
    } finally {
      await cleanupUser(user.userId);
    }
  });

  // ==========================================================
  // CLEANUP
  // ==========================================================

  afterAll(async () => {
    otpProvider.clear();
    await pool.end();
  });
});
