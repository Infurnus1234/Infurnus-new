import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const run = promisify(execFile);
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const databaseName = `infurnus_migration_${randomUUID().replaceAll('-', '')}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const adminPool = new Pool({ connectionString: adminUrl.toString() });

try {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  const migrationResult = await run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'migrate'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
      shell: process.platform === 'win32',
    },
  );
  process.stdout.write(migrationResult.stdout);
  process.stderr.write(migrationResult.stderr);

  const testPool = new Pool({ connectionString: testUrl.toString() });
  try {
    const checks = await testPool.query<{
      migrationCount: string;
      rides: string | null;
      postgis: string | null;
      rideIndex: string | null;
      locationIndex: string | null;
      transitionTrigger: string | null;
      customerForeignKey: string | null;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM schema_migrations) AS "migrationCount",
        to_regclass('public.rides') AS rides,
        (SELECT extname FROM pg_extension WHERE extname = 'postgis') AS postgis,
        to_regclass('public.rides_one_active_per_driver_uidx') AS "rideIndex",
        to_regclass('public.driver_profiles_available_location_gist_idx') AS "locationIndex",
        (SELECT tgname FROM pg_trigger WHERE tgname = 'rides_validate_transition') AS "transitionTrigger",
        (SELECT conname FROM pg_constraint WHERE conname = 'rides_customer_id_fkey') AS "customerForeignKey"
    `);
    const checksRow = checks.rows[0]!;
    if (
      checksRow.migrationCount !== '14' ||
      !checksRow.rides ||
      checksRow.postgis !== 'postgis' ||
      !checksRow.rideIndex ||
      !checksRow.locationIndex ||
      !checksRow.transitionTrigger ||
      !checksRow.customerForeignKey
    ) {
      throw new Error(`Migration verification failed: ${JSON.stringify(checksRow)}`);
    }
    console.log(`Clean migration verification passed for ${databaseName}`);
    console.log(JSON.stringify(checksRow));
  } finally {
    await testPool.end();
  }
} finally {
  await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await adminPool.end();
}
