import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../../infrastructure/database/postgres.js', () => ({
  pool: {
    query: queryMock,
  },
}));

import { PostgresAuthUserRepository } from '../repositories/auth-user.repository.js';

describe('PostgresAuthUserRepository', () => {
  const repository = new PostgresAuthUserRepository();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the user identity when an active non-deleted user exists', async () => {
    const identity = {
      id: '11111111-1111-4111-8111-111111111111',
      role: 'customer',
      status: 'active' as const,
    };

    queryMock.mockResolvedValueOnce({
      rows: [identity],
    });

    const result = await repository.findIdentityById(identity.id);

    expect(result).toEqual(identity);
    expect(queryMock).toHaveBeenCalledOnce();
  });

  it('returns null when the user does not exist', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
    });

    const result = await repository.findIdentityById('22222222-2222-4222-8222-222222222222');

    expect(result).toBeNull();
  });

  it('returns the current database role', async () => {
    const identity = {
      id: '33333333-3333-4333-8333-333333333333',
      role: 'driver',
      status: 'active' as const,
    };

    queryMock.mockResolvedValueOnce({
      rows: [identity],
    });

    const result = await repository.findIdentityById(identity.id);

    expect(result?.role).toBe('driver');
  });

  it('uses a minimal identity projection', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [],
    });

    const userId = '44444444-4444-4444-8444-444444444444';

    await repository.findIdentityById(userId);

    const firstCall = queryMock.mock.calls[0];

    expect(firstCall).toBeDefined();

    if (!firstCall) {
      throw new Error('Expected database query to be called');
    }

    const [query, parameters] = firstCall;

    expect(query).toContain('SELECT');
    expect(query).toContain('id');
    expect(query).toContain('role');
    expect(query).toContain('status');

    expect(query).not.toContain('password_hash');
    expect(query).not.toContain('refresh_tokens');

    expect(query).toContain('deleted_at IS NULL');
    expect(query).toContain('LIMIT 1');

    expect(parameters).toEqual([userId]);
  });

  it('propagates database errors', async () => {
    const databaseError = new Error('Database unavailable');

    queryMock.mockRejectedValueOnce(databaseError);

    await expect(
      repository.findIdentityById('55555555-5555-4555-8555-555555555555'),
    ).rejects.toThrow('Database unavailable');
  });
});
