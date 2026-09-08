import { runMigrations } from './migrations.js';
import { pool } from './postgres.js';

try {
  await runMigrations();
  console.log('Database migrations completed successfully.');
} catch (error) {
  console.error('Database migration failed.', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
