import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.js';
import { verifyAccessToken } from '../../auth/utils/jwt.js';

import type { UserRepository } from '../repositories/user.repository.js';
import type {
  CreateAddressData,
  CreateUserData,
  PublicUser,
  UpdateAddressData,
  UpdateUserData,
  UserAddress,
  UserHistoryEntry,
  UserPreferences,
  UpdateUserPreferencesData,
} from '../types/user.js';

vi.mock('../../auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

const user: PublicUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+14155552671',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const otherUserId = '550e8400-e29b-41d4-a716-446655440002';

const missingUserId = '550e8400-e29b-41d4-a716-446655440001';

const validAccessToken = 'valid-user-token';
const otherAccessToken = 'other-user-token';
const missingUserAccessToken = 'missing-user-token';

const defaultCreatedAt = new Date('2026-01-01T00:00:00.000Z');
const defaultUpdatedAt = new Date('2026-01-01T00:00:00.000Z');

class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, PublicUser>([[user.id, user]]);

  private readonly addresses = new Map<string, UserAddress>();

  private readonly preferences = new Map<string, UserPreferences>([
    [
      user.id,
      {
        userId: user.id,
        pushNotificationsEnabled: true,
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: true,
        createdAt: defaultCreatedAt,
        updatedAt: defaultUpdatedAt,
      },
    ],
  ]);

  private readonly history: UserHistoryEntry[] = [];

  async create(data: CreateUserData): Promise<PublicUser> {
    if ([...this.users.values()].some((existing) => existing.email === data.email)) {
      throw { code: '23505' };
    }

    const now = new Date();

    const created: PublicUser = {
      id: crypto.randomUUID(),
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(created.id, created);

    return created;
  }

  async findById(id: string): Promise<PublicUser | null> {
    return this.users.get(id) ?? null;
  }

  async update(id: string, data: UpdateUserData): Promise<PublicUser | null> {
    const existing = this.users.get(id);

    if (!existing) {
      return null;
    }

    const updated: PublicUser = {
      id: existing.id,
      firstName: data.firstName ?? existing.firstName,
      lastName: data.lastName ?? existing.lastName,
      email: data.email ?? existing.email,
      phone: data.phone ?? existing.phone,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    this.users.set(id, updated);

    return updated;
  }

  async createAddress(userId: string, data: CreateAddressData): Promise<UserAddress> {
    const now = new Date();

    const address: UserAddress = {
      id: crypto.randomUUID(),
      userId,
      label: data.label,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2 ?? null,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode,
      country: data.country ?? 'India',
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      isDefault: data.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };

    if (address.isDefault) {
      for (const existing of this.addresses.values()) {
        if (existing.userId === userId) {
          existing.isDefault = false;
        }
      }
    }

    this.addresses.set(address.id, address);

    return address;
  }

  async updateAddress(
    userId: string,
    addressId: string,
    data: UpdateAddressData,
  ): Promise<UserAddress | null> {
    const existing = this.addresses.get(addressId);

    if (!existing || existing.userId !== userId) {
      return null;
    }

    if (data.isDefault === true) {
      for (const address of this.addresses.values()) {
        if (address.userId === userId && address.id !== addressId) {
          address.isDefault = false;
        }
      }
    }

    const updated: UserAddress = {
      id: existing.id,
      userId: existing.userId,
      label: data.label ?? existing.label,
      addressLine1: data.addressLine1 ?? existing.addressLine1,
      addressLine2: data.addressLine2 ?? existing.addressLine2,
      city: data.city ?? existing.city,
      state: data.state ?? existing.state,
      postalCode: data.postalCode ?? existing.postalCode,
      country: data.country ?? existing.country,
      latitude: data.latitude ?? existing.latitude,
      longitude: data.longitude ?? existing.longitude,
      isDefault: data.isDefault ?? existing.isDefault,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    this.addresses.set(addressId, updated);

    return updated;
  }

  async findAddresses(userId: string): Promise<UserAddress[]> {
    return [...this.addresses.values()].filter((address) => address.userId === userId);
  }

  async findPreferences(userId: string): Promise<UserPreferences | null> {
    return this.preferences.get(userId) ?? null;
  }

  async updatePreferences(
    userId: string,
    data: UpdateUserPreferencesData,
  ): Promise<UserPreferences | null> {
    const existing = this.preferences.get(userId) ?? {
      userId,
      pushNotificationsEnabled: true,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updated: UserPreferences = {
      userId: existing.userId,
      pushNotificationsEnabled: data.pushNotificationsEnabled ?? existing.pushNotificationsEnabled,
      emailNotificationsEnabled:
        data.emailNotificationsEnabled ?? existing.emailNotificationsEnabled,
      smsNotificationsEnabled: data.smsNotificationsEnabled ?? existing.smsNotificationsEnabled,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    this.preferences.set(userId, updated);

    return updated;
  }

  async findHistory(userId: string, limit: number): Promise<UserHistoryEntry[]> {
    return this.history.filter((entry) => entry.userId === userId).slice(0, limit);
  }
}

function configureAccessToken(token: string): void {
  if (token === validAccessToken) {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: user.id,
      role: 'customer',
      type: 'access',
    });

    return;
  }

  if (token === otherAccessToken) {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: otherUserId,
      role: 'customer',
      type: 'access',
    });

    return;
  }

  if (token === missingUserAccessToken) {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: missingUserId,
      role: 'customer',
      type: 'access',
    });

    return;
  }

  vi.mocked(verifyAccessToken).mockRejectedValue(new Error('Invalid or expired token'));
}

function authenticatedGet(
  app: ReturnType<typeof createApp>,
  path: string,
  token = validAccessToken,
) {
  configureAccessToken(token);

  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

function authenticatedPost(
  app: ReturnType<typeof createApp>,
  path: string,
  token = validAccessToken,
) {
  configureAccessToken(token);

  return request(app).post(path).set('Authorization', `Bearer ${token}`);
}

function authenticatedPatch(
  app: ReturnType<typeof createApp>,
  path: string,
  token = validAccessToken,
) {
  configureAccessToken(token);

  return request(app).patch(path).set('Authorization', `Bearer ${token}`);
}

describe('Users API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose POST /users as a user-registration endpoint', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await request(app).post('/users').send({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      phone: '+14155552672',
    });

    expect(response.status).toBe(404);
  });

  it('rejects GET /users/:id without authentication', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await request(app).get(`/users/${user.id}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication required',
    });
  });

  it('rejects PATCH /users/:id without authentication', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await request(app).patch(`/users/${user.id}`).send({
      firstName: 'Updated',
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication required',
    });
  });

  it('rejects access to another user resource', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, `/users/${user.id}`, otherAccessToken);

    expect(response.status).toBe(403);
    expect(response.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this user',
    });
  });

  it('allows an authenticated user to retrieve their own profile', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, `/users/${user.id}`);

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        id: user.id,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: user.email,
        phone: user.phone,
      },
      message: 'User retrieved',
    });

    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('rejects an invalid user ID', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, '/users/not-a-uuid');

    expect(response.status).toBe(403);
    expect(response.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this user',
    });
  });

  it('returns 404 for a non-existent user owned by the authenticated identity', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, `/users/${missingUserId}`, missingUserAccessToken);

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  });

  it('allows an authenticated user to update their own profile', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedPatch(app, `/users/${user.id}`).send({
      firstName: 'Augusta',
    });

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        id: user.id,
        firstName: 'Augusta',
      },
      message: 'User updated',
    });
  });

  it('rejects updating another user profile', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedPatch(app, `/users/${user.id}`, otherAccessToken).send({
      firstName: 'Attacker',
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects address access without authentication', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await request(app).get(`/users/${user.id}/addresses`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('creates, lists, and updates a user address for the authenticated owner', async () => {
    const app = createApp(new InMemoryUserRepository());

    const created = await authenticatedPost(app, `/users/${user.id}/addresses`).send({
      label: 'Home',
      addressLine1: '1 Example Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    });

    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);

    const addressId = created.body.data.id;

    expect(addressId).toEqual(expect.any(String));

    const listed = await authenticatedGet(app, `/users/${user.id}/addresses`);

    expect(listed.status).toBe(200);
    expect(listed.body.success).toBe(true);
    expect(listed.body.data).toHaveLength(1);

    const updated = await authenticatedPatch(app, `/users/${user.id}/addresses/${addressId}`).send({
      isDefault: true,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.success).toBe(true);
    expect(updated.body.data).toMatchObject({
      id: addressId,
      userId: user.id,
      isDefault: true,
    });
  });

  it('rejects another user from accessing addresses', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, `/users/${user.id}/addresses`, otherAccessToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects preferences access without authentication', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await request(app).get(`/users/${user.id}/preferences`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('reads and updates user preferences for the authenticated owner', async () => {
    const app = createApp(new InMemoryUserRepository());

    const initial = await authenticatedGet(app, `/users/${user.id}/preferences`);

    expect(initial.status).toBe(200);
    expect(initial.body.success).toBe(true);

    expect(initial.body.data.pushNotificationsEnabled).toBe(true);

    expect(initial.body.data.emailNotificationsEnabled).toBe(true);

    expect(initial.body.data.smsNotificationsEnabled).toBe(true);

    const updated = await authenticatedPatch(app, `/users/${user.id}/preferences`).send({
      smsNotificationsEnabled: false,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.success).toBe(true);

    expect(updated.body.data.smsNotificationsEnabled).toBe(false);

    expect(updated.body.data.pushNotificationsEnabled).toBe(true);

    expect(updated.body.data.emailNotificationsEnabled).toBe(true);
  });

  it('rejects another user from accessing preferences', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, `/users/${user.id}/preferences`, otherAccessToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects history access without authentication', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await request(app).get(`/users/${user.id}/history`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns an empty history for the authenticated owner', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, `/users/${user.id}/history`);

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      success: true,
      data: [],
      message: 'User history retrieved',
    });
  });

  it('rejects another user from accessing history', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, `/users/${user.id}/history`, otherAccessToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects invalid history user IDs', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, '/users/not-a-uuid/history');

    expect(response.status).toBe(403);
    expect(response.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this user',
    });
  });

  it('returns 404 for an unknown history user owned by the authenticated identity', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(
      app,
      `/users/${missingUserId}/history`,
      missingUserAccessToken,
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  });

  it('rejects an invalid history limit', async () => {
    const app = createApp(new InMemoryUserRepository());

    const response = await authenticatedGet(app, `/users/${user.id}/history?limit=0`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
