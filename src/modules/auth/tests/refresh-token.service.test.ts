import { describe, expect, it, vi } from 'vitest';
import { RefreshTokenService } from '../services/refresh-token.service.js';
import type { RefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import type { RefreshTokenRecord } from '../types/refresh-token.js';
import { hashRefreshToken } from '../utils/refresh-token.js';

function createRepositoryMock(): {
  repository: RefreshTokenRepository;
  create: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn();
  const rotate = vi.fn();

  const repository: RefreshTokenRepository = {
    create,
    findActiveByHash: vi.fn(),
    revoke: vi.fn(),
    revokeFamily: vi.fn(),
    revokeAllForUser: vi.fn(),
    rotate,
  };

  return {
    repository,
    create,
    rotate,
  };
}

function createRefreshTokenRecord(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
  return {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    tokenHash: hashRefreshToken('refresh-token'),
    familyId: crypto.randomUUID(),
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    replacedBy: null,
    userAgent: null,
    ipAddress: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('RefreshTokenService', () => {
  it('creates and persists a refresh token', async () => {
    const { repository, create } = createRepositoryMock();

    const userId = crypto.randomUUID();
    const familyId = crypto.randomUUID();

    const record = createRefreshTokenRecord({
      userId,
      familyId,
    });

    create.mockResolvedValue(record);

    const service = new RefreshTokenService(repository);

    const result = await service.create(
      userId,
      {
        userAgent: 'Mozilla/5.0',
        ipAddress: '127.0.0.1',
      },
      familyId,
    );

    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshTokenId).toBe(record.id);
    expect(result.familyId).toBe(familyId);
    expect(result.userId).toBe(userId);
    expect(result.expiresAt).toEqual(record.expiresAt);

    expect(create).toHaveBeenCalledTimes(1);

    const createCall = create.mock.calls[0];

    expect(createCall).toBeDefined();

    if (!createCall) {
      throw new Error('Expected create to be called');
    }

    const createData = createCall[0];

    expect(createData.userId).toBe(userId);
    expect(createData.familyId).toBe(familyId);
    expect(createData.tokenHash).toHaveLength(64);
    expect(createData.userAgent).toBe('Mozilla/5.0');
    expect(createData.ipAddress).toBe('127.0.0.1');
    expect(createData.expiresAt).toBeInstanceOf(Date);
  });

  it('generates a new family ID when one is not supplied', async () => {
    const { repository, create } = createRepositoryMock();

    const userId = crypto.randomUUID();

    const record = createRefreshTokenRecord({
      userId,
    });

    create.mockImplementation(async (data) => ({
      ...record,
      familyId: data.familyId,
    }));

    const service = new RefreshTokenService(repository);

    const result = await service.create(userId);

    expect(result.familyId).toBeTruthy();
    expect(result.familyId).toEqual(expect.any(String));

    expect(create).toHaveBeenCalledTimes(1);

    const createCall = create.mock.calls[0];

    expect(createCall).toBeDefined();

    if (!createCall) {
      throw new Error('Expected create to be called');
    }

    const createData = createCall[0];

    expect(createData.familyId).toBe(result.familyId);
  });

  it('preserves an explicitly supplied family ID', async () => {
    const { repository, create } = createRepositoryMock();

    const userId = crypto.randomUUID();
    const familyId = crypto.randomUUID();

    const record = createRefreshTokenRecord({
      userId,
      familyId,
    });

    create.mockResolvedValue(record);

    const service = new RefreshTokenService(repository);

    const result = await service.create(userId, {}, familyId);

    expect(result.familyId).toBe(familyId);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        familyId,
      }),
    );
  });

  it('stores a SHA-256 hash instead of the raw refresh token', async () => {
    const { repository, create } = createRepositoryMock();

    const userId = crypto.randomUUID();

    const record = createRefreshTokenRecord({
      userId,
    });

    create.mockResolvedValue(record);

    const service = new RefreshTokenService(repository);

    const result = await service.create(userId);

    const createCall = create.mock.calls[0];

    expect(createCall).toBeDefined();

    if (!createCall) {
      throw new Error('Expected create to be called');
    }

    const createData = createCall[0];

    expect(createData.tokenHash).toBe(hashRefreshToken(result.refreshToken));

    expect(createData.tokenHash).not.toBe(result.refreshToken);
  });

  it('rotates a valid refresh token', async () => {
    const { repository, rotate } = createRepositoryMock();

    const userId = crypto.randomUUID();
    const familyId = crypto.randomUUID();

    const newRecord = createRefreshTokenRecord({
      userId,
      familyId,
    });

    rotate.mockResolvedValue({
      status: 'rotated',
      token: newRecord,
    });

    const service = new RefreshTokenService(repository);

    const result = await service.rotate('old-refresh-token', {
      userAgent: 'Mozilla/5.0',
      ipAddress: '127.0.0.1',
    });

    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshTokenId).toBe(newRecord.id);
    expect(result.userId).toBe(userId);
    expect(result.familyId).toBe(familyId);
    expect(result.expiresAt).toEqual(newRecord.expiresAt);

    expect(rotate).toHaveBeenCalledTimes(1);

    const rotateCall = rotate.mock.calls[0];

    expect(rotateCall).toBeDefined();

    if (!rotateCall) {
      throw new Error('Expected rotate to be called');
    }

    const [oldTokenHash, newToken] = rotateCall;

    expect(oldTokenHash).toBe(hashRefreshToken('old-refresh-token'));

    expect(newToken.tokenHash).toHaveLength(64);
    expect(newToken.tokenHash).not.toBe(oldTokenHash);

    expect(newToken.userAgent).toBe('Mozilla/5.0');
    expect(newToken.ipAddress).toBe('127.0.0.1');
    expect(newToken.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects an empty refresh token', async () => {
    const { repository, rotate } = createRepositoryMock();

    const service = new RefreshTokenService(repository);

    await expect(service.rotate('')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });

    expect(rotate).not.toHaveBeenCalled();
  });

  it('rejects a refresh token that does not exist', async () => {
    const { repository, rotate } = createRepositoryMock();

    rotate.mockResolvedValue({
      status: 'not_found',
    });

    const service = new RefreshTokenService(repository);

    await expect(service.rotate('unknown-token')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  });

  it('rejects an expired refresh token', async () => {
    const { repository, rotate } = createRepositoryMock();

    rotate.mockResolvedValue({
      status: 'expired',
    });

    const service = new RefreshTokenService(repository);

    await expect(service.rotate('expired-token')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  });

  it('detects refresh-token reuse', async () => {
    const { repository, rotate } = createRepositoryMock();

    rotate.mockResolvedValue({
      status: 'reuse_detected',
    });

    const service = new RefreshTokenService(repository);

    await expect(service.rotate('reused-token')).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSE_DETECTED',
      statusCode: 401,
    });
  });

  it('rejects a rotated result without a token record', async () => {
    const { repository, rotate } = createRepositoryMock();

    rotate.mockResolvedValue({
      status: 'rotated',
    });

    const service = new RefreshTokenService(repository);

    await expect(service.rotate('refresh-token')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  });
});
