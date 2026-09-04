import { describe, expect, it, vi } from 'vitest';
import { LogoutService } from '../services/logout.service.js';
import type { RefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import type { RefreshTokenRecord } from '../types/refresh-token.js';
import { hashRefreshToken } from '../utils/refresh-token.js';

function createRepositoryMock(): {
  repository: RefreshTokenRepository;
  findActiveByHash: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
  revokeFamily: ReturnType<typeof vi.fn>;
  revokeAllForUser: ReturnType<typeof vi.fn>;
} {
  const findActiveByHash = vi.fn();
  const revoke = vi.fn();
  const revokeFamily = vi.fn();
  const revokeAllForUser = vi.fn();

  const repository: RefreshTokenRepository = {
    create: vi.fn(),
    findActiveByHash,
    revoke,
    revokeFamily,
    revokeAllForUser,
    rotate: vi.fn(),
  };

  return {
    repository,
    findActiveByHash,
    revoke,
    revokeFamily,
    revokeAllForUser,
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

describe('LogoutService', () => {
  it('revokes the active refresh token', async () => {
    const { repository, findActiveByHash, revoke } = createRepositoryMock();

    const rawRefreshToken = 'refresh-token';
    const record = createRefreshTokenRecord();

    findActiveByHash.mockResolvedValue(record);
    revoke.mockResolvedValue({
      ...record,
      revokedAt: new Date(),
    });

    const service = new LogoutService(repository);

    await expect(service.logout(rawRefreshToken)).resolves.toBeUndefined();

    expect(findActiveByHash).toHaveBeenCalledWith(hashRefreshToken(rawRefreshToken));

    expect(revoke).toHaveBeenCalledWith(record.id);
  });

  it('rejects an empty refresh token', async () => {
    const { repository } = createRepositoryMock();
    const service = new LogoutService(repository);

    await expect(service.logout('')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  });

  it('rejects an unknown or inactive refresh token', async () => {
    const { repository, findActiveByHash } = createRepositoryMock();

    findActiveByHash.mockResolvedValue(null);

    const service = new LogoutService(repository);

    await expect(service.logout('unknown-token')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  });

  it('rejects logout when token revocation fails', async () => {
    const { repository, findActiveByHash, revoke } = createRepositoryMock();

    const record = createRefreshTokenRecord();

    findActiveByHash.mockResolvedValue(record);
    revoke.mockResolvedValue(null);

    const service = new LogoutService(repository);

    await expect(service.logout('refresh-token')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  });

  it('revokes the complete refresh-token family', async () => {
    const { repository, revokeFamily } = createRepositoryMock();

    revokeFamily.mockResolvedValue(undefined);

    const service = new LogoutService(repository);
    const familyId = crypto.randomUUID();

    await expect(service.logoutFamily(familyId)).resolves.toBeUndefined();

    expect(revokeFamily).toHaveBeenCalledWith(familyId);
  });

  it('rejects an empty token family ID', async () => {
    const { repository } = createRepositoryMock();
    const service = new LogoutService(repository);

    await expect(service.logoutFamily('')).rejects.toMatchObject({
      code: 'INVALID_TOKEN_FAMILY',
      statusCode: 400,
    });
  });

  it('revokes all refresh-token sessions for a user', async () => {
    const { repository, revokeAllForUser } = createRepositoryMock();

    revokeAllForUser.mockResolvedValue(undefined);

    const service = new LogoutService(repository);
    const userId = crypto.randomUUID();

    await expect(service.logoutAllForUser(userId)).resolves.toBeUndefined();

    expect(revokeAllForUser).toHaveBeenCalledWith(userId);
  });

  it('rejects an empty user ID', async () => {
    const { repository } = createRepositoryMock();
    const service = new LogoutService(repository);

    await expect(service.logoutAllForUser('')).rejects.toMatchObject({
      code: 'INVALID_USER',
      statusCode: 400,
    });
  });

  it('propagates repository errors when revoking all user sessions', async () => {
    const { repository, revokeAllForUser } = createRepositoryMock();

    const repositoryError = new Error('Database failure');

    revokeAllForUser.mockRejectedValue(repositoryError);

    const service = new LogoutService(repository);
    const userId = crypto.randomUUID();

    await expect(service.logoutAllForUser(userId)).rejects.toBe(repositoryError);

    expect(revokeAllForUser).toHaveBeenCalledWith(userId);
  });
});
