import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import type { CreateUserData, PublicUser, UpdateUserData } from '../types/user.js';
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
    expect(response.body.error).toEqual({ code: 'VALIDATION_ERROR', message: 'Request validation failed' });
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
    const response = await request(createApp(new InMemoryUserRepository())).get(`/users/${user.id}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { id: user.id, email: user.email } });
    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('rejects an invalid user ID', async () => {
    const response = await request(createApp(new InMemoryUserRepository())).get('/users/not-a-uuid');
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
});
