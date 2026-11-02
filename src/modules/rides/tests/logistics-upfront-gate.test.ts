import { describe, expect, it, vi } from 'vitest';
import { RideService } from '../services/ride.service.js';
import type { RideRepository } from '../repositories/ride.repository.js';

function build(ride: Record<string, unknown>) {
  const verifyPinAttempt = vi.fn().mockResolvedValue('verified');
  const findById = vi.fn().mockResolvedValue(ride);
  const service = new RideService({
    findById,
    verifyPinAttempt,
  } as unknown as RideRepository);
  return { service, verifyPinAttempt };
}

describe('logistics 40% upfront payment gate on ride start', () => {
  it('rejects start when logistics upfront payment is not PAID_VERIFIED', async () => {
    for (const status of ['NOT_REQUIRED', 'PENDING', 'FAILED', undefined]) {
      const { service, verifyPinAttempt } = build({
        id: 'ride',
        sector: 'logistics',
        upfrontPaymentStatus: status,
      });
      await expect(
        service.transitionRide('ride', 'in_progress', 'driver', '0007'),
      ).rejects.toMatchObject({ code: 'UPFRONT_PAYMENT_REQUIRED' });
      expect(verifyPinAttempt).not.toHaveBeenCalled();
    }
  });

  it('allows the PIN flow once logistics upfront payment is PAID_VERIFIED', async () => {
    const { service, verifyPinAttempt } = build({
      id: 'ride',
      sector: 'logistics',
      upfrontPaymentStatus: 'PAID_VERIFIED',
    });
    await service.transitionRide('ride', 'in_progress', 'driver', '0007');
    expect(verifyPinAttempt).toHaveBeenCalled();
  });

  it('never applies the payment gate to non-logistics rides', async () => {
    const { service, verifyPinAttempt } = build({
      id: 'ride',
      sector: 'passenger',
      upfrontPaymentStatus: 'PENDING',
    });
    await service.transitionRide('ride', 'in_progress', 'driver', '0007');
    expect(verifyPinAttempt).toHaveBeenCalled();
  });
});
