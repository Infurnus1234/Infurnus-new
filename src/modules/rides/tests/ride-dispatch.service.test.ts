import { afterEach, describe, expect, it, vi } from 'vitest';
import { rideEvents } from '../events/ride.events.js';
import { RideDispatchService } from '../services/ride-dispatch.service.js';
import type { DriverCandidate } from '../types/driver.js';
import type { Ride } from '../types/ride.js';

const ride: Ride = {
  id: 'ride-dispatch-1',
  customerId: 'customer-1',
  assignedDriverId: null,
  assignedVehicleId: null,
  pickup: { latitude: 12.9, longitude: 77.6 },
  destination: { latitude: 12.95, longitude: 77.65 },
  pickupAddress: 'Pickup',
  destinationAddress: 'Destination',
  status: 'searching',
  sector: 'passenger',
  vehicleCategory: 'sedan',
  cancellationReason: null,
  cancelledAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function candidate(id: string): DriverCandidate {
  return {
    driverProfileId: id,
    userId: `${id}-user`,
    vehicleId: `${id}-vehicle`,
    distanceMeters: 100,
    latitude: 12.9,
    longitude: 77.6,
    availabilityStatus: 'available',
    verificationStatus: 'approved',
    activeRideCount: 0,
    locationRecordedAt: new Date(),
    sector: 'passenger',
    vehicleCategory: 'sedan',
  };
}

function fakeRideRepository() {
  let currentLease: string | null = null;
  const attempted = new Set<string>();
  const attempts: Array<{ driver: string; status: string }> = [];

  return {
    attempts,
    offerDispatch: vi.fn(async (_rideId: string, driverId: string) => {
      if (currentLease || attempted.has(driverId)) return false;
      currentLease = driverId;
      attempted.add(driverId);
      return true;
    }),
    finishDispatchAttempt: vi.fn(
      async (_rideId: string, driverId: string, status: 'rejected' | 'timed_out') => {
        if (currentLease !== driverId) return false;
        currentLease = null;
        attempts.push({ driver: driverId, status });
        return true;
      },
    ),
    failDispatch: vi.fn(async () => ({ ...ride, status: 'cancelled' as const })),
  };
}

function matching(...drivers: DriverCandidate[]) {
  return { findRankedDrivers: vi.fn().mockResolvedValue(drivers) };
}

afterEach(() => {
  rideEvents.removeAllListeners('ride:accepted');
  rideEvents.removeAllListeners('ride:dispatch_rejected');
  vi.restoreAllMocks();
});

describe('RideDispatchService', () => {
  it('stops dispatch when the offered driver accepts', async () => {
    const repo = fakeRideRepository();
    const first = candidate('driver-1');
    const notify = vi.fn(async (offered: DriverCandidate) => {
      rideEvents.emit('ride:accepted', { ...ride, assignedDriverId: offered.driverProfileId });
    });
    const dispatcher = new RideDispatchService(repo as never, matching(first, candidate('driver-2')) as never, notify, 100);

    await dispatcher.dispatch(ride);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(repo.offerDispatch).toHaveBeenCalledTimes(1);
    expect(repo.failDispatch).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it('moves to the next ranked driver after rejection', async () => {
    const repo = fakeRideRepository();
    const drivers = [candidate('driver-1'), candidate('driver-2')];
    const notify = vi.fn(async (offered: DriverCandidate) => {
      if (offered.driverProfileId === 'driver-1') {
        await repo.finishDispatchAttempt(ride.id, offered.driverProfileId, 'rejected');
        rideEvents.emit('ride:dispatch_rejected', {
          rideId: ride.id,
          driverProfileId: offered.driverProfileId,
        });
      } else {
        rideEvents.emit('ride:accepted', { ...ride, assignedDriverId: offered.driverProfileId });
      }
    });
    const dispatcher = new RideDispatchService(repo as never, matching(...drivers) as never, notify, 100);

    await dispatcher.dispatch(ride);

    expect(notify.mock.calls.map(([driver]) => driver.driverProfileId)).toEqual([
      'driver-1',
      'driver-2',
    ]);
    expect(repo.attempts).toEqual([{ driver: 'driver-1', status: 'rejected' }]);
    expect(repo.failDispatch).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it('moves to the next ranked driver after timeout', async () => {
    const repo = fakeRideRepository();
    const drivers = [candidate('driver-1'), candidate('driver-2')];
    const notify = vi.fn(async (offered: DriverCandidate) => {
      if (offered.driverProfileId === 'driver-2') {
        rideEvents.emit('ride:accepted', { ...ride, assignedDriverId: offered.driverProfileId });
      }
    });
    const dispatcher = new RideDispatchService(repo as never, matching(...drivers) as never, notify, 5);

    await dispatcher.dispatch(ride);

    expect(notify.mock.calls.map(([driver]) => driver.driverProfileId)).toEqual([
      'driver-1',
      'driver-2',
    ]);
    expect(repo.attempts).toEqual([{ driver: 'driver-1', status: 'timed_out' }]);
    expect(repo.failDispatch).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it('serializes duplicate dispatch events for the same ride', async () => {
    const repo = fakeRideRepository();
    const driver = candidate('driver-1');
    let notified!: () => void;
    const notify = vi.fn(() => new Promise<void>((resolve) => { notified = resolve; }));
    const dispatcher = new RideDispatchService(repo as never, matching(driver) as never, notify, 100);

    const firstDispatch = dispatcher.dispatch(ride);
    const duplicateDispatch = dispatcher.dispatch(ride);
    await Promise.resolve();
    await Promise.resolve();
    rideEvents.emit('ride:accepted', { ...ride, assignedDriverId: driver.driverProfileId });
    notified();
    await Promise.all([firstDispatch, duplicateDispatch]);

    expect(repo.offerDispatch).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    dispatcher.dispose();
  });

  it('cancels a ride only after every eligible driver has been tried', async () => {
    const repo = fakeRideRepository();
    const driver = candidate('driver-1');
    const dispatcher = new RideDispatchService(
      repo as never,
      matching(driver) as never,
      vi.fn(),
      5,
    );

    await dispatcher.dispatch(ride);

    expect(repo.attempts).toEqual([{ driver: 'driver-1', status: 'timed_out' }]);
    expect(repo.failDispatch).toHaveBeenCalledWith(
      ride.id,
      'No eligible drivers accepted the ride',
    );
    dispatcher.dispose();
  });
});
