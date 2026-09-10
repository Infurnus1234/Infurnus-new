import { describe, expect, it, vi } from 'vitest';
import { RentalService } from '../services/rental.service.js';

describe('RentalService lifecycle', () => {
  it('allows PENDING to CONFIRMED', async () => {
    const rental = {
      id: 'rental-1',
      status: 'CONFIRMED',
    };

    const repository = {
      transition: vi.fn().mockResolvedValue(rental),
    };

    const service = new RentalService(repository as never);

    await expect(service.transitionRental('rental-1', 'PENDING', 'CONFIRMED')).resolves.toEqual(
      rental,
    );

    expect(repository.transition).toHaveBeenCalledWith(
      'rental-1',
      'PENDING',
      'CONFIRMED',
      expect.anything(),
    );
  });

  it('allows CONFIRMED to ACTIVE', async () => {
    const repository = {
      transition: vi.fn().mockResolvedValue({
        id: 'rental-1',
        status: 'ACTIVE',
      }),
    };

    const service = new RentalService(repository as never);

    await expect(
      service.transitionRental('rental-1', 'CONFIRMED', 'ACTIVE'),
    ).resolves.toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('allows ACTIVE to COMPLETED', async () => {
    const repository = {
      transition: vi.fn().mockResolvedValue({
        id: 'rental-1',
        status: 'COMPLETED',
      }),
    };

    const service = new RentalService(repository as never);

    await expect(
      service.transitionRental('rental-1', 'ACTIVE', 'COMPLETED'),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
    });
  });

  it('rejects skipping lifecycle states', async () => {
    const repository = {
      transition: vi.fn(),
    };

    const service = new RentalService(repository as never);

    await expect(service.transitionRental('rental-1', 'PENDING', 'ACTIVE')).rejects.toMatchObject({
      code: 'RENTAL_TRANSITION_CONFLICT',
    });

    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('rejects transitions from terminal states', async () => {
    const repository = {
      transition: vi.fn(),
    };

    const service = new RentalService(repository as never);

    await expect(service.transitionRental('rental-1', 'COMPLETED', 'ACTIVE')).rejects.toMatchObject(
      {
        code: 'RENTAL_TRANSITION_CONFLICT',
      },
    );

    await expect(
      service.transitionRental('rental-1', 'CANCELLED', 'CONFIRMED'),
    ).rejects.toMatchObject({
      code: 'RENTAL_TRANSITION_CONFLICT',
    });

    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('allows PENDING and CONFIRMED cancellation through the repository', async () => {
    const repository = {
      cancel: vi.fn().mockResolvedValue({
        id: 'rental-1',
        status: 'CANCELLED',
      }),
    };

    const service = new RentalService(repository as never);

    await expect(
      service.cancelRental('user-1', 'rental-1', {
        reason: 'Customer changed plans',
      }),
    ).resolves.toMatchObject({
      status: 'CANCELLED',
    });
  });
});
