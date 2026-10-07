import { serviceArea, type ServiceAreaGate } from '../../maps/service-area.js';
import { env } from '../../../config/env.js';
import { rideEvents } from '../events/ride.events.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { DriverCandidate } from '../types/driver.js';
import type { Ride } from '../types/ride.js';
import type { MatchingService } from './matching.service.js';

export type DispatchResponse =
  'accepted' | 'rejected' | 'timed_out' | 'delivery_failed' | 'cancelled';

export type NotifyDispatchCandidate = (
  candidate: DriverCandidate,
  ride: Ride,
  expiresAt: Date,
) => void | Promise<void>;

export class RideDispatchService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly pendingResponses = new Set<() => void>();
  private disposed = false;
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private recovering = false;

  startRecovery(intervalMs = 5000): void {
    if (this.disposed || this.recoveryTimer || !this.rides.listRecoverableDispatch) return;
    const run = () => {
      void this.recover().catch(() => {
        console.warn(JSON.stringify({ event: 'ride_dispatch_recovery_failed' }));
      });
    };
    run();
    this.recoveryTimer = setInterval(run, intervalMs);
    this.recoveryTimer.unref();
  }
  async recover(): Promise<void> {
    if (this.disposed || this.recovering || !this.rides.listRecoverableDispatch) return;
    this.recovering = true;
    try {
      const rides = await this.rides.listRecoverableDispatch(20);
      await Promise.all(rides.map((ride) => this.dispatch(ride)));
    } finally {
      this.recovering = false;
    }
  }

  constructor(
    private readonly rides: RideRepository,
    private readonly matching: MatchingService,
    private readonly notify: NotifyDispatchCandidate,
    private readonly responseTimeoutMs = env.DRIVER_DISPATCH_RESPONSE_TIMEOUT_MS,
    private readonly area: ServiceAreaGate = serviceArea,
  ) {}

  dispatch(ride: Ride): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const current = this.inFlight.get(ride.id);
    if (current) return current;

    // Keep session-lock occupancy bounded, leaving database pool headroom.
    // Overflow is durable in searching state and picked up by the recovery sweep.
    if (this.inFlight.size >= 4) return Promise.resolve();
    const work = async () => {
      if (this.disposed) return;
      const current = this.rides.reconcileDispatch
        ? await this.rides.reconcileDispatch(ride.id)
        : ride;
      if (current) await this.dispatchSequentially(current);
    };
    const dispatch = (
      this.rides.withDispatchLock
        ? this.rides.withDispatchLock(ride.id, work).then(() => {})
        : work()
    ).finally(() => {
      if (this.inFlight.get(ride.id) === dispatch) {
        this.inFlight.delete(ride.id);
      }
    });
    this.inFlight.set(ride.id, dispatch);
    return dispatch;
  }

  dispose(): void {
    this.disposed = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    for (const cancel of [...this.pendingResponses]) cancel();
  }

  private async dispatchSequentially(ride: Ride): Promise<void> {
    await this.area.assertSupported([ride.pickup, ride.destination]);
    const candidates = await this.matching.findRankedDrivers(
      ride.pickup,
      ride.sector ?? 'passenger',
      ride.vehicleCategory ?? undefined,
    );

    for (const candidate of candidates) {
      if (this.disposed) return;
      const leased = await this.rides.offerDispatch(
        ride.id,
        candidate.driverProfileId,
        this.responseTimeoutMs,
      );
      if (!leased) continue;

      const expiresAt = new Date(Date.now() + this.responseTimeoutMs);
      const response = await this.awaitResponse(candidate, ride, expiresAt);

      if (this.disposed || response === 'accepted' || response === 'cancelled') return;

      if (response === 'timed_out' || response === 'delivery_failed') {
        await this.rides.finishDispatchAttempt(
          ride.id,
          candidate.driverProfileId,
          response === 'timed_out' ? 'timed_out' : 'rejected',
        );
      }
    }

    if (this.disposed) return;
    const failedRide = await this.rides.failDispatch(
      ride.id,
      'No eligible drivers accepted the ride',
    );
    if (failedRide) rideEvents.emit('ride:cancelled', ride.id);
  }

  private awaitResponse(
    candidate: DriverCandidate,
    ride: Ride,
    expiresAt: Date,
  ): Promise<DispatchResponse> {
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        this.pendingResponses.delete(cancel);
        rideEvents.off('ride:accepted', onAccepted);
        rideEvents.off('ride:dispatch_rejected', onRejected);
        rideEvents.off('ride:cancelled', onCancelled);
      };
      const finish = (response: DispatchResponse) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      };
      const onAccepted = (acceptedRide: Ride) => {
        if (
          acceptedRide.id === ride.id &&
          acceptedRide.assignedDriverId === candidate.driverProfileId
        ) {
          finish('accepted');
        }
      };
      const onRejected = (response: { rideId: string; driverProfileId: string }) => {
        if (response.rideId === ride.id && response.driverProfileId === candidate.driverProfileId) {
          finish('rejected');
        }
      };
      const onCancelled = (id: string) => {
        if (id === ride.id) finish('cancelled');
      };
      const timeout = setTimeout(() => finish('timed_out'), this.responseTimeoutMs);
      const cancel = () => finish('delivery_failed');
      this.pendingResponses.add(cancel);

      rideEvents.on('ride:accepted', onAccepted);
      rideEvents.on('ride:dispatch_rejected', onRejected);
      rideEvents.on('ride:cancelled', onCancelled);
      try {
        void Promise.resolve(this.notify(candidate, ride, expiresAt)).catch(() =>
          finish('delivery_failed'),
        );
      } catch {
        finish('delivery_failed');
      }
    });
  }
}
