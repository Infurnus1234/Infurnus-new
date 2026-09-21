import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { PostgresResendOtpSessionRepository } from '../repositories/resend-otp.repository.js';

describe('PostgresResendOtpSessionRepository', () => {
  let pool: Pool;
  let repository: PostgresResendOtpSessionRepository;
  let email: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }

    pool = new Pool({
      connectionString: databaseUrl,
    });

    repository = new PostgresResendOtpSessionRepository(pool);
    email = `resend-otp-${Date.now()}@example.com`;
  });

  beforeEach(async () => {
    await pool.query(
      `
        DELETE FROM resend_otp_sessions
        WHERE email = $1
      `,
      [email],
    );
  });

  afterAll(async () => {
    await pool.query(
      `
        DELETE FROM resend_otp_sessions
        WHERE email = $1
      `,
      [email],
    );

    await pool.end();
  });

  function createSessionData(
    overrides: Partial<{
      email: string;
      sessionTokenHash: string;
      otpHash: string;
      expiresAt: Date;
      lastSentAt: Date;
    }> = {},
  ) {
    const now = new Date();

    return {
      email,
      sessionTokenHash: `session-${Date.now()}-${Math.random()}`,
      otpHash: `otp-${Date.now()}-${Math.random()}`,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      lastSentAt: now,
      ...overrides,
    };
  }

  it('creates an OTP session', async () => {
    const data = createSessionData();

    const result = await repository.create(data);

    expect(result.id).toBeTruthy();

    const session = await repository.findBySessionTokenHash(data.sessionTokenHash);

    expect(session).not.toBeNull();

    expect(session).toMatchObject({
      id: result.id,
      email: data.email,
      sessionTokenHash: data.sessionTokenHash,
      otpHash: data.otpHash,
      attempts: 0,
      maxAttempts: 10,
    });

    expect(session!.expiresAt).toBeInstanceOf(Date);
    expect(session!.lastSentAt).toBeInstanceOf(Date);
    expect(session!.consumedAt).toBeNull();
  });

  it('returns null for an unknown session', async () => {
    const result = await repository.findBySessionTokenHash('unknown-session-token-hash');

    expect(result).toBeNull();
  });

  it('verifies a correct OTP', async () => {
    const data = createSessionData();

    await repository.create(data);

    const result = await repository.verify(data.sessionTokenHash, data.otpHash);

    expect(result).toEqual({
      status: 'verified',
      attemptsRemaining: 10,
    });

    const session = await repository.findBySessionTokenHash(data.sessionTokenHash);

    expect(session).not.toBeNull();
    expect(session!.consumedAt).not.toBeNull();
  });

  it('rejects an invalid OTP and increments attempts', async () => {
    const data = createSessionData();

    await repository.create(data);

    const result = await repository.verify(data.sessionTokenHash, 'wrong-otp-hash');

    expect(result).toEqual({
      status: 'invalid',
      attemptsRemaining: 9,
    });

    const session = await repository.findBySessionTokenHash(data.sessionTokenHash);

    expect(session).not.toBeNull();
    expect(session!.attempts).toBe(1);
    expect(session!.consumedAt).toBeNull();
  });

  it('rejects verification after maximum attempts', async () => {
    const data = createSessionData();

    await repository.create(data);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await repository.verify(data.sessionTokenHash, 'wrong-otp-hash');
    }

    const result = await repository.verify(data.sessionTokenHash, data.otpHash);

    expect(result).toEqual({
      status: 'attempts_exceeded',
      attemptsRemaining: 0,
    });
  });

  it('rejects an expired OTP session', async () => {
    const data = createSessionData();

    await repository.create(data);

    await pool.query(
      `
        UPDATE resend_otp_sessions
        SET
          created_at = NOW() - INTERVAL '2 minutes',
          expires_at = NOW() - INTERVAL '1 minute',
          updated_at = NOW()
        WHERE session_token_hash = $1
      `,
      [data.sessionTokenHash],
    );

    const result = await repository.verify(data.sessionTokenHash, data.otpHash);

    expect(result).toEqual({
      status: 'expired',
      attemptsRemaining: 10,
    });
  });

  it('returns not_found for an unknown verification session', async () => {
    const result = await repository.verify('unknown-session-token-hash', 'otp-hash');

    expect(result).toEqual({
      status: 'not_found',
    });
  });

  it('resends and replaces the OTP', async () => {
    const data = createSessionData();

    await repository.create(data);

    await repository.verify(data.sessionTokenHash, 'wrong-otp-hash');

    const newOtpHash = 'new-otp-hash';
    const newExpiry = new Date(Date.now() + 10 * 60 * 1000);
    const newLastSentAt = new Date();

    const updated = await repository.resend(
      data.sessionTokenHash,
      newOtpHash,
      newExpiry,
      newLastSentAt,
    );

    expect(updated).toBe(true);

    const session = await repository.findBySessionTokenHash(data.sessionTokenHash);

    expect(session).not.toBeNull();
    expect(session!.otpHash).toBe(newOtpHash);
    expect(session!.attempts).toBe(0);
    expect(session!.expiresAt.getTime()).toBe(newExpiry.getTime());
    expect(session!.lastSentAt.getTime()).toBe(newLastSentAt.getTime());
    expect(session!.consumedAt).toBeNull();
  });

  it('does not resend an expired session', async () => {
    const data = createSessionData();

    await repository.create(data);

    await pool.query(
      `
        UPDATE resend_otp_sessions
        SET
          created_at = NOW() - INTERVAL '2 minutes',
          expires_at = NOW() - INTERVAL '1 minute',
          updated_at = NOW()
        WHERE session_token_hash = $1
      `,
      [data.sessionTokenHash],
    );

    const updated = await repository.resend(
      data.sessionTokenHash,
      'new-otp-hash',
      new Date(Date.now() + 10 * 60 * 1000),
      new Date(),
    );

    expect(updated).toBe(false);
  });

  it('consumes an active session', async () => {
    const data = createSessionData();

    await repository.create(data);

    const result = await repository.consume(data.sessionTokenHash);

    expect(result).toBe(true);

    const session = await repository.findBySessionTokenHash(data.sessionTokenHash);

    expect(session).not.toBeNull();
    expect(session!.consumedAt).not.toBeNull();
  });

  it('does not consume an already consumed session', async () => {
    const data = createSessionData();

    await repository.create(data);

    const first = await repository.consume(data.sessionTokenHash);
    const second = await repository.consume(data.sessionTokenHash);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('allows only one successful concurrent consume', async () => {
    const data = createSessionData();

    await repository.create(data);

    const results = await Promise.all([
      repository.consume(data.sessionTokenHash),
      repository.consume(data.sessionTokenHash),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
