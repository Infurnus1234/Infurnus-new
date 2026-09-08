import { withTransaction } from '../../../infrastructure/database/postgres.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { CancelRideInput, CreateRideInput, ListRidesInput } from '../schemas/ride.schemas.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { RideStatus } from '../types/ride.js';
import type { DriverRepository } from '../repositories/driver.repository.js';

export class RideService {
  constructor(
    private readonly repository: RideRepository,
    private readonly driverRepository?: DriverRepository,
  ) {}

  createRide(customerId: string, input: CreateRideInput) {
    return this.repository.create(customerId, input);
  }

  listRides(customerId: string, query: ListRidesInput) {
    return this.repository.listForCustomer(customerId, query);
  }

  async getRide(customerId: string, id: string) {
    const ride = await this.repository.findByIdForCustomer(id, customerId);
    if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
    return ride;
  }

  async cancelRide(customerId: string, id: string, input: CancelRideInput) {
    const ride = await withTransaction((client) =>
      this.repository.cancel(id, customerId, input.reason, client),
    );
    if (!ride) {
      const existing = await this.repository.findByIdForCustomer(id, customerId);
      if (!existing) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
      throw new AppError(
        'RIDE_CANCELLATION_CONFLICT',
        'Ride cannot be cancelled in its current state',
        409,
      );
    }
    return ride;
  }

  async acceptRide(driverProfileId: string, id: string) {
    try {
      const ride = await withTransaction(async (client) => {
        const accepted = await this.repository.accept(id, driverProfileId, client);
        if (
          accepted &&
          this.driverRepository &&
          !(await this.driverRepository.setBusy(driverProfileId, client))
        ) {
          throw new AppError('DRIVER_CONTENTION_CONFLICT', 'Driver is no longer available', 409);
        }
        return accepted;
      });
      if (!ride) throw new AppError('RIDE_ACCEPTANCE_CONFLICT', 'Ride is no longer available', 409);
      return ride;
    } catch (error) {
      if (isPostgresCode(error, '23505')) {
        throw new AppError(
          'DRIVER_CONTENTION_CONFLICT',
          'Driver is already assigned to another ride',
          409,
        );
      }
      throw error;
    }
  }

  async transitionRide(id: string, status: RideStatus, assignedDriverId?: string) {
    try {
      const ride = await this.repository.transition(id, status, assignedDriverId);
      if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
      return ride;
    } catch (error) {
      if (isPostgresCode(error, 'P0001')) {
        throw new AppError('RIDE_TRANSITION_CONFLICT', 'Invalid ride lifecycle transition', 409);
      }
      throw error;
    }
  }
}

function isPostgresCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
