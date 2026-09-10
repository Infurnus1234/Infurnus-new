import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { CreateRentalInput, ListRentalsInput } from '../schemas/rental.schemas.js';
import type { RentalRepository } from '../repositories/rental.repository.js';
import type { Rental, RentalStatus } from '../types/rental.js';

const userA = '550e8400-e29b-41d4-a716-446655440000';
const userB = '660e8400-e29b-41d4-a716-446655440000';
const vehicleId = '750e8400-e29b-41d4-a716-446655440000';

const rentalA: Rental = {
  id: '850e8400-e29b-41d4-a716-446655440000',
  userId: userA,
  vehicleId,
  startAt: new Date('2030-01-01T04:30:00.000Z'),
  endAt: new Date('2030-01-03T04:30:00.000Z'),
  status: 'PENDING',
  totalAmount: 2500,
  currency: 'INR',
  cancellationReason: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  completedAt: null,
  cancelledAt: null,
};

const rentalB: Rental = {
  ...rentalA,
  id: '960e8400-e29b-41d4-a716-446655440000',
  userId: userB,
};

class InMemoryRentalRepository implements RentalRepository {
  private readonly rentals = new Map<string, Rental>([
    [rentalA.id, rentalA],
    [rentalB.id, rentalB],
  ]);

  async create(userId: string, input: CreateRentalInput, _idempotencyKey: string) {
    const created: Rental = {
      ...rentalA,
      id: crypto.randomUUID(),
      userId,
      vehicleId: input.vehicleId,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      totalAmount: input.totalAmount,
      currency: input.currency,
    };

    this.rentals.set(created.id, created);

    return {
      rental: created,
      created: true,
    };
  }

  async findByIdForUser(id: string, userId: string) {
    const rental = this.rentals.get(id);
    return rental?.userId === userId ? rental : null;
  }

  async listForUser(userId: string, _query: ListRentalsInput) {
    return [...this.rentals.values()].filter((rental) => rental.userId === userId);
  }

  async cancel(id: string, userId: string, reason: string) {
    const rental = await this.findByIdForUser(id, userId);

    if (!rental || !['PENDING', 'CONFIRMED'].includes(rental.status)) {
      return null;
    }

    const cancelled: Rental = {
      ...rental,
      status: 'CANCELLED',
      cancellationReason: reason,
      cancelledAt: new Date(),
    };

    this.rentals.set(id, cancelled);
    return cancelled;
  }

  async transition(id: string, status: RentalStatus) {
    const rental = this.rentals.get(id);

    if (!rental) {
      return null;
    }

    const updated: Rental = {
      ...rental,
      status,
      completedAt: status === 'COMPLETED' ? new Date() : rental.completedAt,
    };

    this.rentals.set(id, updated);
    return updated;
  }

  async findByIdempotencyKey(userId: string, _idempotencyKey: string) {
    return [...this.rentals.values()].find((rental) => rental.userId === userId) ?? null;
  }
}

async function tokenFor(userId: string) {
  return signAccessToken({
    sub: userId,
    role: 'customer',
    type: 'access',
  });
}

describe('Rentals API', () => {
  it('requires authentication', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRentalRepository(),
    );

    const response = await request(app).get('/rentals');

    expect(response.status).toBe(401);
  });

  it('creates a rental with an idempotency key', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRentalRepository(),
    );

    const token = await tokenFor(userA);

    const response = await request(app)
      .post('/rentals')
      .set('authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'rental-create-1')
      .send({
        vehicleId,
        startAt: '2030-01-01T10:00:00+05:30',
        endAt: '2030-01-03T10:00:00+05:30',
        totalAmount: 2500,
        currency: 'INR',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        userId: userA,
        vehicleId,
        status: 'PENDING',
      },
    });
  });

  it('rejects a rental create without Idempotency-Key', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRentalRepository(),
    );

    const token = await tokenFor(userA);

    const response = await request(app)
      .post('/rentals')
      .set('authorization', `Bearer ${token}`)
      .send({
        vehicleId,
        startAt: '2030-01-01T10:00:00+05:30',
        endAt: '2030-01-03T10:00:00+05:30',
        totalAmount: 2500,
        currency: 'INR',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects unknown client fields', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRentalRepository(),
    );

    const token = await tokenFor(userA);

    const response = await request(app)
      .post('/rentals')
      .set('authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'rental-create-2')
      .send({
        vehicleId,
        startAt: '2030-01-01T10:00:00+05:30',
        endAt: '2030-01-03T10:00:00+05:30',
        totalAmount: 2500,
        currency: 'INR',
        userId: userB,
        status: 'ACTIVE',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('prevents one user from retrieving another user rental', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRentalRepository(),
    );

    const token = await tokenFor(userB);

    const response = await request(app)
      .get(`/rentals/${rentalA.id}`)
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RENTAL_NOT_FOUND');
  });

  it('prevents one user from cancelling another user rental', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRentalRepository(),
    );

    const token = await tokenFor(userB);

    const response = await request(app)
      .post(`/rentals/${rentalA.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .send({
        reason: 'Unauthorized cancellation attempt',
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RENTAL_NOT_FOUND');
  });

  it('lists only rentals owned by the authenticated user', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRentalRepository(),
    );

    const token = await tokenFor(userA);

    const response = await request(app).get('/rentals').set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].userId).toBe(userA);
  });
});
