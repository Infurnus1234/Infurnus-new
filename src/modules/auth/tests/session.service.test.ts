import { describe, expect, it, vi } from 'vitest';

import { SessionService } from '../services/session.service.js';
import type { RefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import type { RefreshSessionRecord } from '../types/refresh-session.js';

function createRepositoryMock(): {
  repository: RefreshTokenRepository;
  listActiveSessionsForUser: ReturnType<typeof vi.fn>;
  revokeSessionForUser: ReturnType<typeof vi.fn>;
} {
  const listActiveSessionsForUser = vi.fn();
  const revokeSessionForUser = vi.fn();

  const repository: RefreshTokenRepository = {
    create: vi.fn(),
    findActiveByHash: vi.fn(),
    revoke: vi.fn(),
    revokeFamily: vi.fn(),
    revokeAllForUser: vi.fn(),
    listActiveSessionsForUser,
    revokeSessionForUser,
    rotate: vi.fn(),
  };

  return {
    repository,
    listActiveSessionsForUser,
    revokeSessionForUser,
  };
}

function createSessionRecord(overrides: Partial<RefreshSessionRecord> = {}): RefreshSessionRecord {
  const issuedAt = new Date('2026-09-08T10:00:00.000Z');
  const expiresAt = new Date('2026-10-08T10:00:00.000Z');

  return {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    familyId: crypto.randomUUID(),
    issuedAt,
    expiresAt,
    revokedAt: null,
    userAgent: 'Mozilla/5.0',
    ipAddress: '127.0.0.1',
    ...overrides,
  };
}

describe('SessionService', () => {
  it('lists active sessions for the authenticated user', async () => {
    const { repository, listActiveSessionsForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();

    const firstSession = createSessionRecord({
      userId,
      userAgent: 'Chrome',
      ipAddress: '192.168.1.10',
    });

    const secondSession = createSessionRecord({
      userId,
      userAgent: 'Safari',
      ipAddress: '192.168.1.20',
    });

    listActiveSessionsForUser.mockResolvedValue([firstSession, secondSession]);

    const service = new SessionService(repository);

    const result = await service.listActiveSessions(userId);

    expect(listActiveSessionsForUser).toHaveBeenCalledTimes(1);
    expect(listActiveSessionsForUser).toHaveBeenCalledWith(userId);

    expect(result).toHaveLength(2);

    expect(result).toEqual([
      {
        id: firstSession.id,
        issuedAt: firstSession.issuedAt,
        expiresAt: firstSession.expiresAt,
        revokedAt: firstSession.revokedAt,
        userAgent: firstSession.userAgent,
        ipAddress: firstSession.ipAddress,
      },
      {
        id: secondSession.id,
        issuedAt: secondSession.issuedAt,
        expiresAt: secondSession.expiresAt,
        revokedAt: secondSession.revokedAt,
        userAgent: secondSession.userAgent,
        ipAddress: secondSession.ipAddress,
      },
    ]);
  });

  it('does not expose family ID in the session view', async () => {
    const { repository, listActiveSessionsForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();

    const session = createSessionRecord({
      userId,
      familyId: crypto.randomUUID(),
    });

    listActiveSessionsForUser.mockResolvedValue([session]);

    const service = new SessionService(repository);

    const result = await service.listActiveSessions(userId);

    expect(result).toHaveLength(1);

    expect(result[0]).not.toHaveProperty('familyId');
  });

  it('does not expose refresh-token internals in the session view', async () => {
    const { repository, listActiveSessionsForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();

    const session = createSessionRecord({
      userId,
    });

    listActiveSessionsForUser.mockResolvedValue([session]);

    const service = new SessionService(repository);

    const result = await service.listActiveSessions(userId);

    expect(result).toHaveLength(1);

    const sessionView = result[0];

    expect(sessionView).not.toHaveProperty('tokenHash');
    expect(sessionView).not.toHaveProperty('replacedBy');
    expect(sessionView).not.toHaveProperty('createdAt');
    expect(sessionView).not.toHaveProperty('userId');
  });

  it('preserves nullable device metadata', async () => {
    const { repository, listActiveSessionsForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();

    const session = createSessionRecord({
      userId,
      userAgent: null,
      ipAddress: null,
    });

    listActiveSessionsForUser.mockResolvedValue([session]);

    const service = new SessionService(repository);

    const result = await service.listActiveSessions(userId);

    expect(result).toEqual([
      {
        id: session.id,
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
        revokedAt: null,
        userAgent: null,
        ipAddress: null,
      },
    ]);
  });

  it('rejects an empty user ID when listing sessions', async () => {
    const { repository, listActiveSessionsForUser } = createRepositoryMock();

    const service = new SessionService(repository);

    await expect(service.listActiveSessions('')).rejects.toMatchObject({
      code: 'INVALID_USER',
      statusCode: 400,
    });

    expect(listActiveSessionsForUser).not.toHaveBeenCalled();
  });

  it('revokes a session using both user ID and session ID', async () => {
    const { repository, revokeSessionForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    revokeSessionForUser.mockResolvedValue(
      createSessionRecord({
        id: sessionId,
        userId,
        revokedAt: new Date(),
      }),
    );

    const service = new SessionService(repository);

    await expect(service.revokeSession(userId, sessionId)).resolves.toBeUndefined();

    expect(revokeSessionForUser).toHaveBeenCalledTimes(1);
    expect(revokeSessionForUser).toHaveBeenCalledWith(userId, sessionId);
  });

  it('rejects an empty user ID when revoking a session', async () => {
    const { repository, revokeSessionForUser } = createRepositoryMock();

    const service = new SessionService(repository);
    const sessionId = crypto.randomUUID();

    await expect(service.revokeSession('', sessionId)).rejects.toMatchObject({
      code: 'INVALID_USER',
      statusCode: 400,
    });

    expect(revokeSessionForUser).not.toHaveBeenCalled();
  });

  it('rejects an empty session ID', async () => {
    const { repository, revokeSessionForUser } = createRepositoryMock();

    const service = new SessionService(repository);
    const userId = crypto.randomUUID();

    await expect(service.revokeSession(userId, '')).rejects.toMatchObject({
      code: 'INVALID_SESSION',
      statusCode: 400,
    });

    expect(revokeSessionForUser).not.toHaveBeenCalled();
  });

  it('returns SESSION_NOT_FOUND when the repository cannot revoke the session', async () => {
    const { repository, revokeSessionForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    revokeSessionForUser.mockResolvedValue(null);

    const service = new SessionService(repository);

    await expect(service.revokeSession(userId, sessionId)).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });

    expect(revokeSessionForUser).toHaveBeenCalledWith(userId, sessionId);
  });

  it('propagates repository errors when listing sessions', async () => {
    const { repository, listActiveSessionsForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();
    const repositoryError = new Error('Database failure');

    listActiveSessionsForUser.mockRejectedValue(repositoryError);

    const service = new SessionService(repository);

    await expect(service.listActiveSessions(userId)).rejects.toBe(repositoryError);

    expect(listActiveSessionsForUser).toHaveBeenCalledWith(userId);
  });

  it('propagates repository errors when revoking a session', async () => {
    const { repository, revokeSessionForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const repositoryError = new Error('Database failure');

    revokeSessionForUser.mockRejectedValue(repositoryError);

    const service = new SessionService(repository);

    await expect(service.revokeSession(userId, sessionId)).rejects.toBe(repositoryError);

    expect(revokeSessionForUser).toHaveBeenCalledWith(userId, sessionId);
  });

  it('supports repeated revoke attempts safely at the service boundary', async () => {
    const { repository, revokeSessionForUser } = createRepositoryMock();

    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    revokeSessionForUser
      .mockResolvedValueOnce(
        createSessionRecord({
          id: sessionId,
          userId,
          revokedAt: new Date(),
        }),
      )
      .mockResolvedValueOnce(null);

    const service = new SessionService(repository);

    await expect(service.revokeSession(userId, sessionId)).resolves.toBeUndefined();

    await expect(service.revokeSession(userId, sessionId)).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });

    expect(revokeSessionForUser).toHaveBeenCalledTimes(2);
    expect(revokeSessionForUser).toHaveBeenNthCalledWith(1, userId, sessionId);
    expect(revokeSessionForUser).toHaveBeenNthCalledWith(2, userId, sessionId);
  });
});
