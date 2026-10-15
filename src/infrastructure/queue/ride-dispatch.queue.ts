import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { RideRepository } from '../../modules/rides/repositories/ride.repository.js';
import type { RideDispatchService } from '../../modules/rides/services/ride-dispatch.service.js';
export interface DispatchDeadline {
  rideId: string;
  driverProfileId: string;
  expiresAt: string;
}
export function startRideDispatchQueue(
  url: string,
  rides: RideRepository,
  dispatch: Pick<RideDispatchService, 'dispatch'>,
  name = 'ride-dispatch-deadlines',
) {
  const producer = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    commandTimeout: 1000,
  });
  const consumer = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    connectTimeout: 1000,
  });
  const queue = new Queue<DispatchDeadline>(name, {
    connection: producer,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  const worker = new Worker<DispatchDeadline>(
    name,
    async (job) => {
      const ride = await rides.findById(job.data.rideId);
      if (!ride || ride.status !== 'searching' || ride.assignedDriverId) return;
      // SQL checks both the pending state and persisted deadline. A stale or duplicate
      // job cannot expire a newer offer, revive an old request, or change a terminal ride.
      const changed = await rides.finishDispatchAttempt(
        ride.id,
        job.data.driverProfileId,
        'timed_out',
      );
      if (changed)
        void dispatch
          .dispatch(ride)
          .catch(() =>
            console.warn(JSON.stringify({ event: 'ride_dispatch_deadline_progress_failed' })),
          );
    },
    { connection: consumer, concurrency: 4 },
  );
  const onError = () => console.warn(JSON.stringify({ event: 'ride_dispatch_queue_unavailable' }));
  producer.on('error', onError);
  consumer.on('error', onError);
  queue.on('error', onError);
  worker.on('error', onError);
  return {
    async schedule(rideId: string, driverProfileId: string, expiresAt: Date) {
      await queue.add(
        'expire',
        { rideId, driverProfileId, expiresAt: expiresAt.toISOString() },
        {
          jobId: `${rideId}-${driverProfileId}-${expiresAt.getTime()}`,
          delay: Math.max(0, expiresAt.getTime() - Date.now()),
        },
      );
    },
    async close() {
      await worker.close();
      await queue.close();
      producer.disconnect();
      consumer.disconnect();
    },
  };
}
