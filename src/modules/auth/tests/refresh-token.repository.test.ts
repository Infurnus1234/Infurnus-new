import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, withTransactionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  withTransactionMock: vi.fn(),
}));

vi.mock('../../../infrastructure/database/postgres.js', () => ({
  pool: {
    query: queryMock,
  },
  withTransaction: withTransactionMock,
}));

import { PostgresRefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import type {
  CreateRefreshTokenData,
  RefreshTokenRecord,
  RotateRefreshTokenData,
} from '../types/refresh-token.js';

describe('PostgresRefreshTokenRepository', () => {
  const repository = new PostgresRefreshTokenRepository();

  const userId = '11111111-1111-4111-8111-111111111111';
  const tokenId = '22222222-2222-4222-8222-222222222222';
  const familyId = '33333333-3333-4333-8333-333333333333';
  const replacementId = '44444444-4444-4444-8444-444444444444';

  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const pastDate = new Date(Date.now() - 60 * 1000);

  const record: RefreshTokenRecord = {
    id: tokenId,
    userId,
    tokenHash: 'hashed-refresh-token',
    familyId,
    issuedAt: new Date(),
    expiresAt: futureDate,
    revokedAt: null,
    replacedBy: null,
    userAgent: 'Vitest',
    ipAddress: '127.0.0.1',
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates and returns a refresh-token record', async () => {
      const data: CreateRefreshTokenData = {
        userId,
        tokenHash: 'hashed-refresh-token',
        familyId,
        expiresAt: futureDate,
        userAgent: 'Vitest',
        ipAddress: '127.0.0.1',
      };

      queryMock.mockResolvedValueOnce({
        rows: [record],
      });

      const result = await repository.create(data);

      expect(result).toEqual(record);
      expect(queryMock).toHaveBeenCalledOnce();

      const [query, parameters] = queryMock.mock.calls[0];

      expect(query).toContain('INSERT INTO refresh_tokens');
      expect(query).toContain('token_hash');
      expect(query).toContain('family_id');
      expect(query).toContain('expires_at');
      expect(query).toContain('user_agent');
      expect(query).toContain('ip_address');
      expect(query).toContain('RETURNING');

      expect(parameters).toEqual([
        userId,
        'hashed-refresh-token',
        familyId,
        futureDate,
        'Vitest',
        '127.0.0.1',
      ]);
    });

    it('does not persist a raw refresh token', async () => {
      const data: CreateRefreshTokenData = {
        userId,
        tokenHash: 'sha256-hashed-token',
        familyId,
        expiresAt: futureDate,
      };

      queryMock.mockResolvedValueOnce({
        rows: [record],
      });

      await repository.create(data);

      const [, parameters] = queryMock.mock.calls[0];

      expect(parameters).toContain('sha256-hashed-token');
      expect(parameters).not.toContain('raw-refresh-token');
    });
  });

  describe('findActiveByHash', () => {
    it('returns an active, non-expired token', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [record],
      });

      const result = await repository.findActiveByHash('hashed-refresh-token');

      expect(result).toEqual(record);
      expect(queryMock).toHaveBeenCalledOnce();

      const [query, parameters] = queryMock.mock.calls[0];

      expect(query).toContain('token_hash = $1');
      expect(query).toContain('revoked_at IS NULL');
      expect(query).toContain('expires_at > NOW()');
      expect(query).toContain('LIMIT 1');

      expect(parameters).toEqual(['hashed-refresh-token']);
    });

    it('returns null when no active token is found', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [],
      });

      const result = await repository.findActiveByHash('unknown-token-hash');

      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('revokes an active token', async () => {
      const revokedRecord: RefreshTokenRecord = {
        ...record,
        revokedAt: new Date(),
      };

      queryMock.mockResolvedValueOnce({
        rows: [revokedRecord],
      });

      const result = await repository.revoke(tokenId);

      expect(result).toEqual(revokedRecord);

      const [query, parameters] = queryMock.mock.calls[0];

      expect(query).toContain('UPDATE refresh_tokens');
      expect(query).toContain('revoked_at = NOW()');
      expect(query).toContain('revoked_at IS NULL');

      expect(parameters).toEqual([tokenId, null]);
    });

    it('sets replaced_by when revoking during rotation', async () => {
      const revokedRecord: RefreshTokenRecord = {
        ...record,
        revokedAt: new Date(),
        replacedBy: replacementId,
      };

      queryMock.mockResolvedValueOnce({
        rows: [revokedRecord],
      });

      const result = await repository.revoke(tokenId, replacementId);

      expect(result).toEqual(revokedRecord);

      const [, parameters] = queryMock.mock.calls[0];

      expect(parameters).toEqual([tokenId, replacementId]);
    });

    it('returns null when the token is already revoked or missing', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [],
      });

      const result = await repository.revoke(tokenId);

      expect(result).toBeNull();
    });
  });

  describe('revokeFamily', () => {
    it('revokes all active tokens in a family', async () => {
      queryMock.mockResolvedValueOnce({
        rowCount: 3,
        rows: [],
      });

      await repository.revokeFamily(familyId);

      expect(queryMock).toHaveBeenCalledOnce();

      const [query, parameters] = queryMock.mock.calls[0];

      expect(query).toContain('UPDATE refresh_tokens');
      expect(query).toContain('family_id = $1');
      expect(query).toContain('revoked_at IS NULL');

      expect(parameters).toEqual([familyId]);
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes all active refresh tokens for a user', async () => {
      queryMock.mockResolvedValueOnce({
        rowCount: 4,
        rows: [],
      });

      await repository.revokeAllForUser(userId);

      expect(queryMock).toHaveBeenCalledOnce();

      const [query, parameters] = queryMock.mock.calls[0];

      expect(query).toContain('UPDATE refresh_tokens');
      expect(query).toContain('user_id = $1');
      expect(query).toContain('revoked_at IS NULL');

      expect(parameters).toEqual([userId]);
    });
  });

  describe('rotate', () => {
    const newToken: RotateRefreshTokenData = {
      tokenHash: 'new-hashed-refresh-token',
      expiresAt: futureDate,
      userAgent: 'New-Agent',
      ipAddress: '10.0.0.1',
    };

    function setupTransaction(
      transactionCallback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>,
    ) {
      const client = {
        query: vi.fn(),
      };

      withTransactionMock.mockImplementationOnce(
        async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) =>
          callback(client),
      );

      return {
        client,
        transactionCallback,
      };
    }

    it('returns not_found when the old token does not exist', async () => {
      const { client } = setupTransaction(async () => undefined);

      client.query.mockResolvedValueOnce({
        rows: [],
      });

      const result = await repository.rotate('missing-token-hash', newToken);

      expect(result).toEqual({
        status: 'not_found',
      });

      expect(withTransactionMock).toHaveBeenCalledOnce();
      expect(client.query).toHaveBeenCalledOnce();

      const [query, parameters] = client.query.mock.calls[0];

      expect(query).toContain('FOR UPDATE');
      expect(query).toContain('token_hash = $1');
      expect(parameters).toEqual(['missing-token-hash']);
    });

    it('returns expired when the old token has expired', async () => {
      const expiredRecord: RefreshTokenRecord = {
        ...record,
        expiresAt: pastDate,
      };

      const { client } = setupTransaction(async () => undefined);

      client.query.mockResolvedValueOnce({
        rows: [expiredRecord],
      });

      const result = await repository.rotate('expired-token-hash', newToken);

      expect(result).toEqual({
        status: 'expired',
      });

      expect(client.query).toHaveBeenCalledOnce();
    });

    it('detects reuse and revokes the token family', async () => {
      const revokedRecord: RefreshTokenRecord = {
        ...record,
        revokedAt: new Date(),
      };

      const { client } = setupTransaction(async () => undefined);

      client.query
        .mockResolvedValueOnce({
          rows: [revokedRecord],
        })
        .mockResolvedValueOnce({
          rowCount: 2,
          rows: [],
        });

      const result = await repository.rotate('reused-token-hash', newToken);

      expect(result).toEqual({
        status: 'reuse_detected',
      });

      expect(client.query).toHaveBeenCalledTimes(2);

      const [familyQuery, familyParameters] = client.query.mock.calls[1];

      expect(familyQuery).toContain('UPDATE refresh_tokens');
      expect(familyQuery).toContain('family_id = $1');
      expect(familyQuery).toContain('revoked_at IS NULL');

      expect(familyParameters).toEqual([familyId]);
    });

    it('rotates an active refresh token inside a transaction', async () => {
      const createdRecord: RefreshTokenRecord = {
        ...record,
        id: replacementId,
        tokenHash: newToken.tokenHash,
        userAgent: newToken.userAgent ?? null,
        ipAddress: newToken.ipAddress ?? null,
      };

      const { client } = setupTransaction(async () => undefined);

      client.query
        .mockResolvedValueOnce({
          rows: [record],
        })
        .mockResolvedValueOnce({
          rows: [createdRecord],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [],
        });

      const result = await repository.rotate('old-token-hash', newToken);

      expect(result).toEqual({
        status: 'rotated',
        token: createdRecord,
      });

      expect(withTransactionMock).toHaveBeenCalledOnce();
      expect(client.query).toHaveBeenCalledTimes(3);

      const [selectQuery, selectParameters] = client.query.mock.calls[0];

      expect(selectQuery).toContain('FOR UPDATE');
      expect(selectQuery).toContain('token_hash = $1');
      expect(selectParameters).toEqual(['old-token-hash']);

      const [insertQuery, insertParameters] = client.query.mock.calls[1];

      expect(insertQuery).toContain('INSERT INTO refresh_tokens');
      expect(insertQuery).toContain('token_hash');
      expect(insertQuery).toContain('family_id');

      expect(insertParameters).toEqual([
        userId,
        newToken.tokenHash,
        familyId,
        newToken.expiresAt,
        newToken.userAgent,
        newToken.ipAddress,
      ]);

      const [revokeQuery, revokeParameters] = client.query.mock.calls[2];

      expect(revokeQuery).toContain('revoked_at = NOW()');
      expect(revokeQuery).toContain('replaced_by = $1');

      expect(revokeParameters).toEqual([replacementId, tokenId]);
    });

    it('preserves old device context when new context is absent', async () => {
      const tokenWithoutContext: RotateRefreshTokenData = {
        tokenHash: 'new-hashed-token',
        expiresAt: futureDate,
      };

      const createdRecord: RefreshTokenRecord = {
        ...record,
        id: replacementId,
        tokenHash: tokenWithoutContext.tokenHash,
      };

      const { client } = setupTransaction(async () => undefined);

      client.query
        .mockResolvedValueOnce({
          rows: [record],
        })
        .mockResolvedValueOnce({
          rows: [createdRecord],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [],
        });

      await repository.rotate('old-token-hash', tokenWithoutContext);

      const [, insertParameters] = client.query.mock.calls[1];

      expect(insertParameters).toEqual([
        userId,
        tokenWithoutContext.tokenHash,
        familyId,
        tokenWithoutContext.expiresAt,
        record.userAgent,
        record.ipAddress,
      ]);
    });
  });
});
