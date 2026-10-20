import { describe, expect, it, vi } from 'vitest';
import { RideService } from '../services/ride.service.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import {
  generateRidePin,
  pinVerifier,
  sealRidePin,
  openRidePin,
  matchesPinVerifier,
} from '../repositories/ride-pin.js';

describe('atomic four-digit ride PIN contract', () => {
  it('generates four-character secure PINs including the zero-padded domain', () => {
    const pins = new Set(Array.from({ length: 100 }, () => generateRidePin()));
    expect(pins.size).toBeGreaterThan(1);
    for (const pin of pins) expect(pin).toMatch(/^\d{4}$/);
  });
  it('seals leading-zero PINs and binds verifiers and ciphertext to one ride', () => {
    const sealed = sealRidePin('ride-a', '0007');
    expect(openRidePin('ride-a', sealed)).toBe('0007');
    expect(() => openRidePin('ride-b', sealed)).toThrow();
    expect(sealed).not.toContain('0007');
    expect(matchesPinVerifier('ride-a', '0007', pinVerifier('ride-a', '0007'))).toBe(true);
    expect(matchesPinVerifier('ride-b', '0007', pinVerifier('ride-a', '0007'))).toBe(false);
    expect(matchesPinVerifier('ride-a', '0008', pinVerifier('ride-a', '0007'))).toBe(false);
  });
  for (const pin of ['', '12', '12345', 'abcd'])
    it(`rejects malformed input of length ${pin.length}`, async () => {
      const verifyPinAttempt = vi.fn();
      const service = new RideService({ verifyPinAttempt } as unknown as RideRepository);
      await expect(service.verifyRidePin('ride', 'driver', pin)).rejects.toMatchObject({
        code: 'INVALID_PIN',
      });
      expect(verifyPinAttempt).not.toHaveBeenCalled();
    });
  for (const [result, code] of [
    ['invalid', 'INVALID_PIN'],
    ['locked', 'PIN_ATTEMPTS_EXCEEDED'],
    ['forbidden', 'FORBIDDEN'],
    ['invalid_state', 'INVALID_RIDE_STATE'],
    ['not_found', 'RIDE_NOT_FOUND'],
  ])
    it(`maps authoritative ${result} without any separate start`, async () => {
      const transition = vi.fn();
      const service = new RideService({
        verifyPinAttempt: vi.fn().mockResolvedValue(result),
        transition,
      } as unknown as RideRepository);
      await expect(
        service.transitionRide('ride', 'in_progress', 'driver', '0007'),
      ).rejects.toMatchObject({ code });
      expect(transition).not.toHaveBeenCalled();
    });
  it('fails closed without the atomic repository capability', async () => {
    const service = new RideService({
      getRidePin: vi.fn().mockResolvedValue('0007'),
    } as unknown as RideRepository);
    await expect(service.verifyRidePin('ride', 'driver', '0007')).rejects.toMatchObject({
      code: 'PIN_SERVICE_UNAVAILABLE',
    });
  });
  it('rejects direct start without PIN even if legacy verified state exists', async () => {
    const verifyPinAttempt = vi.fn();
    const service = new RideService({
      verifyPinAttempt,
      isPinVerified: vi.fn().mockResolvedValue(true),
    } as unknown as RideRepository);
    await expect(service.transitionRide('ride', 'in_progress', 'driver')).rejects.toMatchObject({
      code: 'PIN_VERIFICATION_REQUIRED',
    });
    expect(verifyPinAttempt).not.toHaveBeenCalled();
  });
  it('returns the persisted trip only after atomic verification', async () => {
    const transition = vi.fn();
    const service = new RideService({
      verifyPinAttempt: vi.fn().mockResolvedValue('verified'),
      findById: vi.fn().mockResolvedValue({ id: 'ride', status: 'in_progress', pinVerified: true }),
      transition,
    } as unknown as RideRepository);
    expect(await service.transitionRide('ride', 'in_progress', 'driver', '0007')).toMatchObject({
      status: 'in_progress',
      pinVerified: true,
    });
    expect(transition).not.toHaveBeenCalled();
  });
});
