import { pool } from './postgres.js';
import { baselineExistingMigrations } from './migrations.js';

try {
  await baselineExistingMigrations();
  console.log('Existing database migrations baselined successfully.');
} catch (error) {
  console.error('Database migration baseline failed.', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
