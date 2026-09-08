import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString: databaseUrl });
const migrationsDirectory = join(process.cwd(), 'migrations');

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const appliedResult = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  const applied = new Set(appliedResult.rows.map((row) => row.filename));

  for (const filename of migrationFiles) {
    if (applied.has(filename)) continue;
    const client = await pool.connect();
    try {
      await client.query(await readFile(join(migrationsDirectory, filename), 'utf8'));
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      console.log(`Applied ${filename}`);
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
