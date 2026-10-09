import { describe, expect, it, vi } from 'vitest';
import { evaluatePinAttempt, PIN_LOCK_MS } from '../repositories/ride-pin.js';
import { DriverService } from '../services/driver.service.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import { driverEligibilitySql } from '../repositories/driver-eligibility.js';
import { authorizeSocketRole } from '../../../infrastructure/socket/socket.authorization.js';
import type { Socket } from 'socket.io';

describe('Driver audit security regressions', () => {
  it('locks the fifth failed PIN and cannot bypass the lock with the correct PIN', () => {
    let metadata: Record<string, unknown> = {};
    for (let i = 1; i <= 5; i++) {
      const next = evaluatePinAttempt('7391', '0000', metadata, 1000);
      expect(next.result).toBe(i === 5 ? 'locked' : 'invalid');
      metadata = next.metadata;
    }
    expect(evaluatePinAttempt('7391', '7391', metadata, 1001).result).toBe('locked');
    const correct = evaluatePinAttempt('7391', '7391', metadata, 1000 + PIN_LOCK_MS);
    expect(correct.result).toBe('verified');
    expect(correct.metadata.pinFailedAttempts).toBe(0);
  });
  it('starts a new attempt window after lock expiry and preserves unrelated route metadata', () => {
    const result = evaluatePinAttempt(
      '1234',
      '0000',
      { pinFailedAttempts: 5, pinLockedUntil: 1000, routeVersion: 7 },
      1001,
    );
    expect(result.result).toBe('invalid');
    expect(result.metadata).toMatchObject({ pinFailedAttempts: 1, routeVersion: 7 });
  });
  it('accepts a licence expiring today through the whole UTC calendar day', async () => {
    const repository = {
      findProfileByUserId: vi.fn().mockResolvedValue({
        id: 'profile',
        verificationStatus: 'approved',
        licenseExpiry: '2026-10-08',
      }),
      getAvailability: vi.fn().mockResolvedValue('unavailable'),
      updateAvailability: vi.fn().mockResolvedValue(true),
    } as unknown as DriverRepository;
    await new DriverService(repository, () => new Date('2026-10-08T23:59:59Z')).updateAvailability(
      'user',
      { status: 'available' },
    );
    expect(repository.updateAvailability).toHaveBeenCalledWith('profile', 'available');
    await expect(
      new DriverService(repository, () => new Date('2026-10-09T00:00:00Z')).updateAvailability(
        'user',
        { status: 'available' },
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_EXPIRED' });
  });
  it('shares licence, membership, account, registration, active vehicle and compliance eligibility in dispatch', () => {
    const sql = driverEligibilitySql('$1', '$2');
    for (const predicate of [
      'u.deleted_at IS NULL',
      "u.role IN ('driver','driver_fleet_owner')",
      'dp.license_expiry >= CURRENT_DATE',
      'dp.active_vehicle_id = v.id',
      'v.registration_expiry >= CURRENT_DATE',
      "pd.status='ACTIVE'",
      'provider_compliance_satisfied',
      'last_location_at >= $1',
      'pending_offer.id <> $2',
    ])
      expect(sql).toContain(predicate);
    expect(sql).not.toContain('active_vehicle_id IS NULL');
  });
  it.each(['driver', 'fleet_owner', undefined])(
    'combined socket permissions narrow to the selected %s mode',
    (mode) => {
      const socket = {
        data: { auth: { userId: 'combined', role: 'driver_fleet_owner' } },
        handshake: { auth: { providerMode: mode } },
      } as unknown as Socket;
      if (mode === 'fleet_owner') expect(() => authorizeSocketRole(socket, ['driver'])).toThrow();
      else expect(authorizeSocketRole(socket, ['driver']).userId).toBe('combined');
      if (mode === 'driver') expect(() => authorizeSocketRole(socket, ['fleet_owner'])).toThrow();
    },
  );
  it('a provider mode never grants a Driver role to a customer', () => {
    const socket = {
      data: { auth: { userId: 'customer', role: 'customer' } },
      handshake: { auth: { providerMode: 'driver' } },
    } as unknown as Socket;
    expect(() => authorizeSocketRole(socket, ['driver'])).toThrow();
  });
});
