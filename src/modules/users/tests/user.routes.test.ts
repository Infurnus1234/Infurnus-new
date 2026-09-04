import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
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
import type { UserRepository } from '../repositories/user.repository.js';

const user: PublicUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+14155552671',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map([[user.id, user]]);
  private readonly addresses = new Map<string, UserAddress>();
  private readonly preferences = new Map<string, UserPreferences>();
  private readonly history: UserHistoryEntry[] = [];

  async create(data: CreateUserData) {
    if ([...this.users.values()].some((existing) => existing.email === data.email)) {
      throw { code: '23505' };
    }
    const created = { ...user, ...data, id: crypto.randomUUID() };
    this.users.set(created.id, created);
    return created;
  }

  async findById(id: string) {
    return this.users.get(id) ?? null;
  }

  async update(id: string, data: UpdateUserData) {
    const existing = this.users.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.users.set(id, updated);
    return updated;
  }

  async createAddress(userId: string, data: CreateAddressData) {
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.addresses.set(address.id, address);
    return address;
  }

  async updateAddress(userId: string, addressId: string, data: UpdateAddressData) {
    const existing = this.addresses.get(addressId);
    if (!existing || existing.userId !== userId) return null;
    const updated: UserAddress = {
      ...existing,
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
      updatedAt: new Date(),
    };
    this.addresses.set(addressId, updated);
    return updated;
  }

  async findAddresses(userId: string) {
    return [...this.addresses.values()].filter((address) => address.userId === userId);
  }

  async findPreferences(userId: string) {
    return this.preferences.get(userId) ?? null;
  }

  async updatePreferences(userId: string, data: UpdateUserPreferencesData) {
    const existing = this.preferences.get(userId) ?? {
      userId,
      pushNotificationsEnabled: true,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updated: UserPreferences = {
      ...existing,
      pushNotificationsEnabled: data.pushNotificationsEnabled ?? existing.pushNotificationsEnabled,
      emailNotificationsEnabled:
        data.emailNotificationsEnabled ?? existing.emailNotificationsEnabled,
      smsNotificationsEnabled: data.smsNotificationsEnabled ?? existing.smsNotificationsEnabled,
      updatedAt: new Date(),
    };
    this.preferences.set(userId, updated);
    return updated;
  }

  async findHistory(userId: string, limit: number) {
    return this.history.filter((entry) => entry.userId === userId).slice(0, limit);
  }
}

describe('Users API', () => {
  it('creates a valid user', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).post('/users').send({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'Grace@example.com',
      phone: '+14155552672',
      passwordHash: 'must-not-be-accepted',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a valid user without sensitive input', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).post('/users').send({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'Grace@example.com',
      phone: '+14155552672',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, data: { firstName: 'Grace' } });
    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('rejects missing and invalid create fields', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).post('/users').send({
      firstName: 'Ada',
      email: 'bad-email',
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });
  });

  it('rejects duplicate email', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).post('/users').send({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+14155552671',
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('USER_ALREADY_EXISTS');
  });

  it('retrieves an existing user', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).get(
      `/users/${user.id}`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { id: user.id, email: user.email },
    });
    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('rejects an invalid user ID', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).get(
      '/users/not-a-uuid',
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an error for a non-existent user', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).get(
      '/users/550e8400-e29b-41d4-a716-446655440001',
    );
    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({ code: 'USER_NOT_FOUND', message: 'User not found' });
  });

  it('creates, lists, and updates a user address', async () => {
    const app = createApp(new InMemoryUserRepository());
    const created = await request(app).post(`/users/${user.id}/addresses`).send({
      label: 'Home',
      addressLine1: '1 Example Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    });
    expect(created.status).toBe(201);
    const addressId = created.body.data.id;
    expect((await request(app).get(`/users/${user.id}/addresses`)).body.data).toHaveLength(1);
    const updated = await request(app)
      .patch(`/users/${user.id}/addresses/${addressId}`)
      .send({ isDefault: true });
    expect(updated.status).toBe(200);
    expect(updated.body.data.isDefault).toBe(true);
  });

  it('reads and updates user preferences', async () => {
    const app = createApp(new InMemoryUserRepository());
    const initial = await request(app).get(`/users/${user.id}/preferences`);
    expect(initial.body.data.pushNotificationsEnabled).toBe(true);
    const updated = await request(app)
      .patch(`/users/${user.id}/preferences`)
      .send({ smsNotificationsEnabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.smsNotificationsEnabled).toBe(false);
  });

  it('returns an empty history for an existing user', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).get(
      `/users/${user.id}/history`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [],
      message: 'User history retrieved',
    });
  });

  it('rejects invalid and unknown history user IDs', async () => {
    const app = createApp(new InMemoryUserRepository());
    const invalid = await request(app).get('/users/not-a-uuid/history');
    expect(invalid.status).toBe(400);
    const missing = await request(app).get('/users/550e8400-e29b-41d4-a716-446655440001/history');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('rejects an invalid history limit', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).get(
      `/users/${user.id}/history?limit=0`,
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
