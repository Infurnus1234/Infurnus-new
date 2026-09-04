import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthUserService } from '../services/auth-user.service.js';
import type { AuthUserRepository } from '../repositories/auth-user.repository.js';
import type { AuthUserIdentity } from '../types/auth-identity.js';

function createRepositoryMock(): {
  repository: AuthUserRepository;
  findIdentityById: ReturnType<typeof vi.fn>;
} {
  const findIdentityById = vi.fn();

  const repository: AuthUserRepository = {
    findIdentityById,
  };

  return {
    repository,
    findIdentityById,
  };
}

function createIdentity(overrides: Partial<AuthUserIdentity> = {}): AuthUserIdentity {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    role: 'customer',
    status: 'active',
    ...overrides,
  };
}

describe('AuthUserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the identity for an active user', async () => {
    const { repository, findIdentityById } = createRepositoryMock();

    const identity = createIdentity();

    findIdentityById.mockResolvedValue(identity);

    const service = new AuthUserService(repository);

    const result = await service.getIdentity(identity.id);

    expect(result).toEqual(identity);

    expect(findIdentityById).toHaveBeenCalledTimes(1);

    expect(findIdentityById).toHaveBeenCalledWith(identity.id);
  });

  it('returns the current user role from the repository', async () => {
    const { repository, findIdentityById } = createRepositoryMock();

    const identity = createIdentity({
      role: 'driver',
    });

    findIdentityById.mockResolvedValue(identity);

    const service = new AuthUserService(repository);

    const result = await service.getIdentity(identity.id);

    expect(result.id).toBe(identity.id);
    expect(result.role).toBe('driver');
    expect(result.status).toBe('active');
  });

  it('rejects a user that does not exist', async () => {
    const { repository, findIdentityById } = createRepositoryMock();

    findIdentityById.mockResolvedValue(null);

    const service = new AuthUserService(repository);

    await expect(service.getIdentity('550e8400-e29b-41d4-a716-446655440001')).rejects.toMatchObject(
      {
        code: 'INVALID_REFRESH_TOKEN',
        statusCode: 401,
      },
    );

    expect(findIdentityById).toHaveBeenCalledTimes(1);
  });

  it('rejects a suspended user', async () => {
    const { repository, findIdentityById } = createRepositoryMock();

    const identity = createIdentity({
      status: 'suspended',
    });

    findIdentityById.mockResolvedValue(identity);

    const service = new AuthUserService(repository);

    await expect(service.getIdentity(identity.id)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_ACTIVE',
      statusCode: 401,
    });

    expect(findIdentityById).toHaveBeenCalledWith(identity.id);
  });

  it('rejects a banned user', async () => {
    const { repository, findIdentityById } = createRepositoryMock();

    const identity = createIdentity({
      status: 'banned',
    });

    findIdentityById.mockResolvedValue(identity);

    const service = new AuthUserService(repository);

    await expect(service.getIdentity(identity.id)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_ACTIVE',
      statusCode: 401,
    });

    expect(findIdentityById).toHaveBeenCalledWith(identity.id);
  });

  it('propagates repository errors', async () => {
    const { repository, findIdentityById } = createRepositoryMock();

    const repositoryError = new Error('Database failure');

    findIdentityById.mockRejectedValue(repositoryError);

    const service = new AuthUserService(repository);

    await expect(service.getIdentity('550e8400-e29b-41d4-a716-446655440002')).rejects.toBe(
      repositoryError,
    );

    expect(findIdentityById).toHaveBeenCalledTimes(1);
  });
});
