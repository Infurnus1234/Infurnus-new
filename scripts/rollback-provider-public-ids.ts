import 'dotenv/config';
import { pool } from '../src/infrastructure/database/postgres.js';

// Rollback is a pause, never a destructive down migration or a counter rewind.
const actor = process.argv[2];
const database = process.argv[3];
try {
  if (!actor || !database)
    throw new Error(
      'Usage: tsx scripts/rollback-provider-public-ids.ts SUPER_ADMIN_UUID EXACT_DATABASE_NAME [--resume]',
    );
  if ((await pool.query('SELECT current_database() AS name')).rows[0].name !== database)
    throw new Error('Target database mismatch');
  await pool.query('SELECT pause_provider_id_allocation($1,$2)', [
    !process.argv.includes('--resume'),
    actor,
  ]);
  console.log(
    JSON.stringify({
      retainedAllMappings: true,
      capacity: (await pool.query('SELECT * FROM provider_id_capacity')).rows[0],
    }),
  );
} finally {
  await pool.end();
}
