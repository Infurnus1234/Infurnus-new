import { AppError } from '../../../common/errors/app-error.js';
import { withTransaction } from '../../../infrastructure/database/postgres.js';
import type {
  CancelRentalInput,
  CreateRentalInput,
  ListRentalsInput,
} from '../schemas/rental.schemas.js';
import type { RentalRepository } from '../repositories/rental.repository.js';
import type { RentalStatus } from '../types/rental.js';

export class RentalService {
  constructor(private readonly repository: RentalRepository) {}

  async createRental(userId: string, input: CreateRentalInput, idempotencyKey: string) {
    try {
      const result = await withTransaction((client) =>
        this.repository.create(userId, input, idempotencyKey, client),
      );

      if (!result.created) {
        const existing = result.rental;

        if (
          existing.vehicleId !== input.vehicleId ||
          existing.startAt.getTime() !== new Date(input.startAt).getTime() ||
          existing.endAt.getTime() !== new Date(input.endAt).getTime() ||
          existing.totalAmount !== input.totalAmount ||
          existing.currency !== input.currency
        ) {
          throw new AppError(
            'RENTAL_IDEMPOTENCY_CONFLICT',
            'Idempotency key was already used with different rental details',
            409,
          );
        }
      }

      return result.rental;
    } catch (error) {
      if (isPostgresCode(error, '23P01')) {
        throw new AppError(
          'RENTAL_AVAILABILITY_CONFLICT',
          'Vehicle is not available for the requested rental period',
          409,
        );
      }

      throw error;
    }
  }

  listRentals(userId: string, query: ListRentalsInput) {
    return this.repository.listForUser(userId, query);
  }

  async getRental(userId: string, id: string) {
    const rental = await this.repository.findByIdForUser(id, userId);

    if (!rental) {
      throw new AppError('RENTAL_NOT_FOUND', 'Rental not found', 404);
    }

    return rental;
  }

  async cancelRental(userId: string, id: string, input: CancelRentalInput) {
    const rental = await withTransaction((client) =>
      this.repository.cancel(id, userId, input.reason, client),
    );

    if (!rental) {
      const existing = await this.repository.findByIdForUser(id, userId);

      if (!existing) {
        throw new AppError('RENTAL_NOT_FOUND', 'Rental not found', 404);
      }

      throw new AppError(
        'RENTAL_CANCELLATION_CONFLICT',
        'Rental cannot be cancelled in its current state',
        409,
      );
    }

    return rental;
  }

  async transitionRental(id: string, currentStatus: RentalStatus, nextStatus: RentalStatus) {
    if (!isValidTransition(currentStatus, nextStatus)) {
      throw new AppError('RENTAL_TRANSITION_CONFLICT', 'Invalid rental lifecycle transition', 409);
    }

    const rental = await withTransaction((client) =>
      this.repository.transition(id, currentStatus, nextStatus, client),
    );

    if (!rental) {
      throw new AppError('RENTAL_NOT_FOUND', 'Rental not found', 404);
    }

    return rental;
  }
}

function isValidTransition(currentStatus: RentalStatus, nextStatus: RentalStatus): boolean {
  const transitions: Record<RentalStatus, readonly RentalStatus[]> = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: [],
  };

  return transitions[currentStatus].includes(nextStatus);
}

function isPostgresCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
