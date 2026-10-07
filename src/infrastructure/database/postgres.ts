import { Pool, type PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';

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

/** Current sockets/events/presence are process-local: one serving process per database. */
export async function acquireBackendInstance(onLost: () => void): Promise<() => Promise<void>> {
  const client = await pool.connect();
  const key = 874011;
  const boundedQuery = async <T>(work: () => Promise<T>): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Instance session timeout')), 1500);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  let released = false;
  const heartbeat: { timer?: ReturnType<typeof setInterval> } = {};
  let checking = false;
  const lose = () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat.timer);
    client.release(new Error('Backend instance session lost'));
    onLost();
  };
  client.on('error', lose);
  try {
    const result = await boundedQuery(() =>
      client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]),
    );
    if (!result.rows[0]?.locked)
      throw new AppError(
        'BACKEND_SINGLE_INSTANCE_REQUIRED',
        'Another backend instance is already serving this database',
        503,
      );
  } catch (error) {
    client.off('error', lose);
    if (!released)
      client.release(
        error instanceof AppError ? undefined : new Error('Instance startup query failed'),
      );
    throw error;
  }
  heartbeat.timer = setInterval(() => {
    if (checking || released) return;
    checking = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      client.query('SELECT 1'),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Instance heartbeat timeout')), 1500);
      }),
    ])
      .catch(lose)
      .finally(() => {
        clearTimeout(timeout);
        checking = false;
      });
  }, 1000);
  heartbeat.timer.unref();
  return async () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat.timer);
    try {
      await boundedQuery(() => client.query('SELECT pg_advisory_unlock($1)', [key]));
      client.off('error', lose);
      client.release();
    } catch {
      client.off('error', lose);
      client.release(new Error('Backend instance unlock failed'));
    }
  };
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
