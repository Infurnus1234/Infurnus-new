// Isolated QA subprocess, invoked only by the database recovery test.
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { MatchingService } from '../services/matching.service.js';
import { RideDispatchService } from '../services/ride-dispatch.service.js';
import { RideService } from '../services/ride.service.js';
const url = new URL(process.env.DATABASE_URL!);
if (
  process.env.NODE_ENV !== 'test' ||
  url.port !== '5434' ||
  !/^\/admin_master_test_[a-f0-9]{32}$/.test(url.pathname)
)
  throw Error('Owned QA database required');
const repo = new PostgresRideRepository(pool),
  drivers = new PostgresDriverRepository(pool),
  service = new RideService(repo, drivers),
  ride = await repo.findById(process.argv[2]!);
if (!ride) throw Error('QA ride missing');
const controller = new RideDispatchService(
  repo,
  new MatchingService(drivers),
  async (candidate) => {
    await service.acceptRide(candidate.driverProfileId, ride.id);
    process.send?.({ state: 'accepted', driverProfileId: candidate.driverProfileId });
  },
);
if (process.argv[3] === 'pending')
  controller.setDeadlineScheduler(async () => {
    process.send?.({ state: 'pending' });
  });
try {
  await controller.dispatch(ride);
} finally {
  controller.dispose();
  await pool.end();
  process.disconnect?.();
}
