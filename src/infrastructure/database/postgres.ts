import { Pool } from 'pg';
import { env } from '../../config/env.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function checkDatabaseConnection(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
