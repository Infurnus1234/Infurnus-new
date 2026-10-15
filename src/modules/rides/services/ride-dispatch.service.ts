import { serviceArea, type ServiceAreaGate } from '../../maps/service-area.js';
import { env } from '../../../config/env.js';
import { rideEvents } from '../events/ride.events.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { DriverCandidate } from '../types/driver.js';
import type { Ride } from '../types/ride.js';
import type { MatchingService } from './matching.service.js';
import { dispatchPolicy } from './dispatch-policy.js';

export type DispatchResponse =
  'accepted' | 'rejected' | 'timed_out' | 'delivery_failed' | 'cancelled';

export type NotifyDispatchCandidate = (
  candidate: DriverCandidate,
  ride: Ride,
  expiresAt: Date,
) => void | Promise<void>;

export class RideDispatchService {
  private scheduleDeadline?: (
    rideId: string,
    driverProfileId: string,
    expiresAt: Date,
  ) => Promise<void>;
  setDeadlineScheduler(
    schedule: (rideId: string, driverProfileId: string, expiresAt: Date) => Promise<void>,
  ): void {
    this.scheduleDeadline = schedule;
  }
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
      const rides = await this.rides.listRecoverableDispatch(20, [...this.inFlight.keys()]);
      // A premium request can remain pending for an hour. Recovery starts work
      // without waiting for that response or monopolizing the recovery sweep.
      for (const ride of rides)
        void this.dispatch(ride).catch(() =>
          console.warn(JSON.stringify({ event: 'ride_dispatch_recovery_failed' })),
        );
    } finally {
      this.recovering = false;
    }
  }

  constructor(
    private readonly rides: RideRepository,
    private readonly matching: MatchingService,
    private readonly notify: NotifyDispatchCandidate,
    private readonly responseTimeoutMs?: number,
    private readonly area: ServiceAreaGate = serviceArea,
  ) {
    rideEvents.on('ride:dispatch_rejected', this.onProgress);
  }
  private readonly onProgress = (event: { rideId: string }) => {
    if (this.disposed || !this.rides.findById) return;
    void this.rides
      .findById(event.rideId)
      .then((ride) => (ride ? this.dispatch(ride) : undefined))
      .catch(() => console.warn(JSON.stringify({ event: 'ride_dispatch_progress_failed' })));
  };

  dispatch(ride: Ride): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const current = this.inFlight.get(ride.id);
    if (current) return current;

    // Each ride has one local coordinator; PostgreSQL arbitrates across processes.
    const work = async () => {
      if (this.disposed) return;
      await this.dispatchSequentially(ride);
    };
    const dispatch = work().finally(() => {
      if (this.inFlight.get(ride.id) === dispatch) {
        this.inFlight.delete(ride.id);
      }
    });
    this.inFlight.set(ride.id, dispatch);
    return dispatch;
  }

  dispose(): void {
    this.disposed = true;
    rideEvents.off('ride:dispatch_rejected', this.onProgress);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    for (const cancel of [...this.pendingResponses]) cancel();
  }

  private async dispatchSequentially(ride: Ride): Promise<void> {
    await this.area.assertSupported([ride.pickup, ride.destination]);
    const policy = dispatchPolicy(ride.sector ?? 'passenger', ride.vehicleCategory ?? '');
    const timeoutMs =
      policy.kind === 'premium'
        ? policy.responseMs
        : env.NODE_ENV === 'test' && this.responseTimeoutMs !== undefined
          ? this.responseTimeoutMs
          : policy.responseMs;
    const radii =
      typeof this.matching.findDispatchDrivers === 'function'
        ? policy.radiiMeters.length
          ? policy.radiiMeters
          : [null]
        : [null];
    const attempted = new Set<string>();
    let declinedOffer = false;
    for (const radius of radii) {
      while (!this.disposed) {
        const existing = await this.rides.pendingDispatch?.(ride.id);
        if (existing) {
          this.schedulePersistedDeadline(ride.id, existing.driverProfileId, existing.expiresAt);
          const response = await this.awaitResponse(
            null,
            ride,
            existing.expiresAt,
            existing.driverProfileId,
          );
          if (this.disposed || response === 'accepted' || response === 'cancelled') return;
          if (response === 'timed_out')
            await this.rides.finishDispatchAttempt(ride.id, existing.driverProfileId, 'timed_out');
          continue;
        }
        const current = this.rides.reconcileDispatch
          ? await this.rides.reconcileDispatch(ride.id)
          : ride;
        if (!current) return;
        const candidates = this.matching.findDispatchDrivers
          ? await this.matching.findDispatchDrivers(current, radius)
          : await this.matching.findRankedDrivers(
              ride.pickup,
              ride.sector ?? 'passenger',
              ride.vehicleCategory ?? undefined,
            );
        let offeredAny = false;
        for (const candidate of candidates) {
          if (this.disposed) return;
          if (attempted.has(candidate.driverProfileId)) continue;
          attempted.add(candidate.driverProfileId);
          const offer = () =>
            candidate.dispatchCityId && candidate.dispatchBoundaryGeoJson
              ? this.rides.offerDispatch(ride.id, candidate.driverProfileId, timeoutMs, {
                  cityId: candidate.dispatchCityId,
                  boundaryGeoJson: candidate.dispatchBoundaryGeoJson,
                })
              : this.rides.offerDispatch(ride.id, candidate.driverProfileId, timeoutMs);
          // Do not hold a session advisory lock or database connection while waiting.
          const leased = this.rides.withDispatchLock
            ? await this.rides.withDispatchLock(ride.id, offer)
            : await offer();
          if (!leased) {
            declinedOffer = true;
            continue;
          }
          offeredAny = true;
          const lease = await this.rides.pendingDispatch?.(ride.id);
          if (this.rides.pendingDispatch && !lease) continue;
          const expiresAt = lease?.expiresAt ?? new Date(Date.now() + timeoutMs);
          this.schedulePersistedDeadline(ride.id, candidate.driverProfileId, expiresAt);
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
        if (!offeredAny) break;
      }
    }

    if (this.disposed || declinedOffer) return; // A competing dispatcher or changed eligibility must be reconciled, never cancelled by a losing snapshot.
    const failedRide = await this.rides.failDispatch(
      ride.id,
      'No eligible drivers accepted the ride',
    );
    if (failedRide) rideEvents.emit('ride:cancelled', ride.id);
  }

  private awaitResponse(
    candidate: DriverCandidate | null,
    ride: Ride,
    expiresAt: Date,
    driverProfileId = candidate!.driverProfileId,
  ): Promise<DispatchResponse> {
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(revalidate);
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
        if (acceptedRide.id === ride.id) {
          finish('accepted');
        }
      };
      const onRejected = (response: { rideId: string; driverProfileId: string }) => {
        if (response.rideId === ride.id && response.driverProfileId === driverProfileId) {
          finish('rejected');
        }
      };
      const onCancelled = (id: string) => {
        if (id === ride.id) finish('cancelled');
      };
      const timeout = setTimeout(
        () => finish('timed_out'),
        Math.max(0, expiresAt.getTime() - Date.now()),
      );
      const cancel = () => finish('delivery_failed');
      let checking = false;
      // Availability, compliance or location may change during a long offer.
      // Recheck without shortening a valid offer's authoritative deadline.
      const revalidate = setInterval(() => {
        if (checking || settled || !this.rides.pendingDispatch) return;
        checking = true;
        void this.rides
          .pendingDispatch(ride.id)
          .then((pending) => {
            if (!settled && (!pending || pending.driverProfileId !== driverProfileId))
              finish('rejected');
          })
          .catch(() =>
            console.warn(JSON.stringify({ event: 'ride_dispatch_eligibility_check_failed' })),
          )
          .finally(() => {
            checking = false;
          });
      }, 1000);
      revalidate.unref();
      this.pendingResponses.add(cancel);

      rideEvents.on('ride:accepted', onAccepted);
      rideEvents.on('ride:dispatch_rejected', onRejected);
      rideEvents.on('ride:cancelled', onCancelled);
      try {
        if (candidate)
          void Promise.resolve(this.notify(candidate, ride, expiresAt)).catch(() =>
            finish('delivery_failed'),
          );
      } catch {
        finish('delivery_failed');
      }
    });
  }
  private schedulePersistedDeadline(rideId: string, driverProfileId: string, expiresAt: Date) {
    if (this.scheduleDeadline)
      void this.scheduleDeadline(rideId, driverProfileId, expiresAt).catch(() =>
        console.warn(
          JSON.stringify({ event: 'ride_dispatch_schedule_failed', fallback: 'postgres_recovery' }),
        ),
      );
  }
}
