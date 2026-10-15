// Disposable local integration worker: pause inside actual BullMQ job processing.
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { startRideDispatchQueue } from '../../../infrastructure/queue/ride-dispatch.queue.js';
const db = new URL(process.env.DATABASE_URL!);
if (
  process.env.NODE_ENV !== 'test' ||
  db.port !== '5434' ||
  !/^\/admin_master_test_[a-f0-9]{32}$/.test(db.pathname)
)
  throw Error('Owned QA database required');
const repo = new PostgresRideRepository(pool);
const find = repo.findById.bind(repo);
repo.findById = async (id) => {
  const ride = await find(id);
  process.send?.({ state: 'processing' });
  await new Promise(() => {});
  return ride;
};
startRideDispatchQueue(
  process.env.DISPATCH_QA_REDIS_URL!,
  repo,
  { dispatch: async () => {} },
  process.argv[2]!,
);
process.send?.({ state: 'ready' });
