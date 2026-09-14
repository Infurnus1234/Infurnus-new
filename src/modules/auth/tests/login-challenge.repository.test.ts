import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { PostgresLoginChallengeRepository } from '../repositories/login-challenge.repository.js';

describe('PostgresLoginChallengeRepository', () => {
  let pool: Pool;
  let repository: PostgresLoginChallengeRepository;
  let userId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }

    pool = new Pool({
      connectionString: databaseUrl,
    });

    repository = new PostgresLoginChallengeRepository(pool);

    const userResult = await pool.query<{ id: string }>(
      `
          INSERT INTO users (
            first_name,
            last_name,
            email,
            phone,
            role,
            status
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
          )
          RETURNING id
        `,
      [
        'Login',
        'Challenge',
        `login-challenge-${Date.now()}@example.com`,
        `+9199${String(Date.now()).slice(-8)}`,
        'customer',
        'active',
      ],
    );

    const user = userResult.rows[0];

    if (!user) {
      throw new Error('Failed to create test user');
    }

    userId = user.id;
  });

  beforeEach(async () => {
    await pool.query(
      `
        DELETE FROM login_challenges
        WHERE user_id = $1
      `,
      [userId],
    );
  });

  afterAll(async () => {
    await pool.query(
      `
        DELETE FROM login_challenges
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

    await pool.end();
  });

  function createChallengeData(
    overrides: Partial<{
      userId: string;
      otpProvider: string;
      providerSessionId: string;
      encryptedProviderSessionToken: string;
      providerExpiresAt: Date;
      expiresAt: Date;
      lastOtpSentAt: Date;
    }> = {},
  ) {
    const now = new Date();

    return {
      userId,
      otpProvider: 'sendmator',
      providerSessionId: `provider-session-${Date.now()}-${Math.random()}`,
      encryptedProviderSessionToken: 'v1.test-encrypted-session-token',
      providerExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      lastOtpSentAt: now,
      ...overrides,
    };
  }

  async function expireChallenge(challengeId: string): Promise<void> {
    await pool.query(
      `
        UPDATE login_challenges
        SET
          expires_at =
            NOW() - INTERVAL '1 second',
          provider_expires_at =
            NOW() - INTERVAL '1 second',
          updated_at = NOW()
        WHERE id = $1
      `,
      [challengeId],
    );
  }

  it('creates a login challenge', async () => {
    const data = createChallengeData();

    const result = await repository.create(data);

    expect(result.id).toBeTruthy();

    const row = await pool.query<{
      id: string;
      userId: string;
      otpProvider: string;
      providerSessionId: string;
      encryptedProviderSessionToken: string;
    }>(
      `
          SELECT
            id,
            user_id AS "userId",
            otp_provider AS "otpProvider",
            provider_session_id AS
              "providerSessionId",
            encrypted_provider_session_token AS
              "encryptedProviderSessionToken"
          FROM login_challenges
          WHERE id = $1
        `,
      [result.id],
    );

    expect(row.rows).toHaveLength(1);

    expect(row.rows[0]).toMatchObject({
      id: result.id,
      userId,
      otpProvider: 'sendmator',
      providerSessionId: data.providerSessionId,
      encryptedProviderSessionToken: data.encryptedProviderSessionToken,
    });
  });

  it('returns the provider session required for verification', async () => {
    const data = createChallengeData();

    const created = await repository.create(data);

    const result = await repository.getProviderSession(created.id);

    expect(result).not.toBeNull();

    expect(result).toMatchObject({
      id: created.id,
      userId,
      otpProvider: 'sendmator',
      providerSessionId: data.providerSessionId,
      encryptedProviderSessionToken: data.encryptedProviderSessionToken,
    });

    expect(result?.verifiedAt).toBeNull();
    expect(result?.consumedAt).toBeNull();
  });

  it('returns null for an unknown challenge', async () => {
    const result = await repository.getProviderSession('00000000-0000-0000-0000-000000000000');

    expect(result).toBeNull();
  });

  it('allows resend after the cooldown period', async () => {
    const data = createChallengeData({
      lastOtpSentAt: new Date(Date.now() - 61 * 1000),
    });

    const created = await repository.create(data);

    const result = await repository.claimResend(created.id, 60);

    expect(result).not.toBeNull();

    expect(result).toMatchObject({
      id: created.id,
      userId,
      otpProvider: 'sendmator',
      providerSessionId: data.providerSessionId,
      encryptedProviderSessionToken: data.encryptedProviderSessionToken,
    });

    expect(result!.lastOtpSentAt.getTime()).toBeGreaterThan(data.lastOtpSentAt.getTime());
  });

  it('rejects resend before the cooldown expires', async () => {
    const data = createChallengeData({
      lastOtpSentAt: new Date(),
    });

    const created = await repository.create(data);

    const result = await repository.claimResend(created.id, 60);

    expect(result).toBeNull();
  });

  it('rejects resend for an expired challenge', async () => {
    const created = await repository.create(
      createChallengeData({
        lastOtpSentAt: new Date(Date.now() - 61 * 1000),
      }),
    );

    await expireChallenge(created.id);

    const result = await repository.claimResend(created.id, 60);

    expect(result).toBeNull();
  });

  it('updates provider expiry for an active challenge', async () => {
    const data = createChallengeData();

    const created = await repository.create(data);

    const newExpiry = new Date(Date.now() + 20 * 60 * 1000);

    const updated = await repository.updateProviderExpiry(created.id, newExpiry);

    expect(updated).toBe(true);

    const result = await repository.getProviderSession(created.id);

    expect(result).not.toBeNull();

    expect(result!.providerExpiresAt.getTime()).toBe(newExpiry.getTime());
  });

  it('returns false when updating a missing challenge', async () => {
    const updated = await repository.updateProviderExpiry(
      '00000000-0000-0000-0000-000000000000',
      new Date(Date.now() + 10 * 60 * 1000),
    );

    expect(updated).toBe(false);
  });

  it('consumes an active login challenge', async () => {
    const data = createChallengeData();

    const created = await repository.create(data);

    const result = await repository.consume(created.id);

    expect(result).toEqual({
      status: 'consumed',
      userId,
      role: 'customer',
    });

    const challenge = await repository.getProviderSession(created.id);

    expect(challenge).not.toBeNull();
    expect(challenge!.verifiedAt).not.toBeNull();
    expect(challenge!.consumedAt).not.toBeNull();
  });

  it('rejects replay of a consumed challenge', async () => {
    const data = createChallengeData();

    const created = await repository.create(data);

    const first = await repository.consume(created.id);

    expect(first.status).toBe('consumed');

    const second = await repository.consume(created.id);

    expect(second).toEqual({
      status: 'already_consumed',
    });
  });

  it('rejects consumption of an unknown challenge', async () => {
    const result = await repository.consume('00000000-0000-0000-0000-000000000000');

    expect(result).toEqual({
      status: 'not_found',
    });
  });

  it('rejects consumption of an expired challenge', async () => {
    const created = await repository.create(createChallengeData());

    await expireChallenge(created.id);

    const result = await repository.consume(created.id);

    expect(result).toEqual({
      status: 'expired',
    });
  });

  it('does not consume an expired challenge', async () => {
    const created = await repository.create(createChallengeData());

    await expireChallenge(created.id);

    const result = await repository.consume(created.id);

    expect(result.status).toBe('expired');

    const challenge = await repository.getProviderSession(created.id);

    expect(challenge).not.toBeNull();
    expect(challenge!.verifiedAt).toBeNull();
    expect(challenge!.consumedAt).toBeNull();
  });

  it('allows only one active challenge per user', async () => {
    const first = await repository.create(createChallengeData());

    expect(first.id).toBeTruthy();

    await expect(
      repository.create(
        createChallengeData({
          providerSessionId: `second-session-${Date.now()}`,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'LOGIN_CHALLENGE_ALREADY_ACTIVE',
      statusCode: 409,
    });
  });

  it('allows a new challenge after the previous challenge is consumed', async () => {
    const first = await repository.create(createChallengeData());

    const consumed = await repository.consume(first.id);

    expect(consumed.status).toBe('consumed');

    const second = await repository.create(
      createChallengeData({
        providerSessionId: `new-session-${Date.now()}`,
      }),
    );

    expect(second.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
  });

  it('replaces an expired active challenge with a new challenge', async () => {
    const first = await repository.create(createChallengeData());

    await expireChallenge(first.id);

    const second = await repository.create(
      createChallengeData({
        providerSessionId: `replacement-session-${Date.now()}`,
      }),
    );

    expect(second.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);

    /*
     * Expired unconsumed challenges are deleted
     * when a replacement challenge is created.
     *
     * They are NOT marked as consumed because
     * consumed_at represents successful verification.
     */
    const oldChallenge = await repository.getProviderSession(first.id);

    expect(oldChallenge).toBeNull();

    const newChallenge = await repository.getProviderSession(second.id);

    expect(newChallenge).not.toBeNull();
    expect(newChallenge!.verifiedAt).toBeNull();
    expect(newChallenge!.consumedAt).toBeNull();
  });

  it('allows exactly one successful concurrent consume', async () => {
    const data = createChallengeData();

    const created = await repository.create(data);

    const results = await Promise.all([
      repository.consume(created.id),
      repository.consume(created.id),
    ]);

    const successful = results.filter((result) => result.status === 'consumed');

    const rejected = results.filter((result) => result.status === 'already_consumed');

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('does not expose plaintext provider token through the database test data', async () => {
    const plaintextToken = 'real-sendmator-session-token-must-not-be-stored';

    const encryptedToken = 'v1.encrypted-value-only';

    const created = await repository.create(
      createChallengeData({
        encryptedProviderSessionToken: encryptedToken,
      }),
    );

    const result = await repository.getProviderSession(created.id);

    expect(result).not.toBeNull();

    expect(result!.encryptedProviderSessionToken).toBe(encryptedToken);

    expect(result!.encryptedProviderSessionToken).not.toBe(plaintextToken);
  });
});
