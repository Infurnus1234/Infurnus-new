import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { pool } from './postgres.js';

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const migrationTable = 'schema_migrations';
const migrationLockKey = 248173901;

const baselineMigrations = [
  '001_create_users_auth_foundation.sql',
  '002_create_user_addresses_preferences.sql',
  '003_create_partners.sql',
  '004_harden_partner_constraints.sql',
  '005_create_signup_otp.sql',
  '006_create_vehicles.sql',
] as const;

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${migrationTable} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await readdir(migrationsDirectory);

  return files.filter((file) => file.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

async function getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ filename: string }>(
    `SELECT filename FROM ${migrationTable} ORDER BY filename`,
  );

  return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(client: PoolClient, filename: string): Promise<void> {
  const migrationPath = path.join(migrationsDirectory, filename);
  const migrationSql = await readFile(migrationPath, 'utf8');

  await client.query('BEGIN');

  try {
    await client.query(migrationSql);

    await client.query(`INSERT INTO ${migrationTable} (filename) VALUES ($1)`, [filename]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function assertTableExists(client: PoolClient, tableName: string): Promise<void> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `Cannot baseline existing migrations: required table "${tableName}" is missing.`,
    );
  }
}

async function assertConstraintExists(
  client: PoolClient,
  tableName: string,
  constraintName: string,
): Promise<void> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = $1::regclass
          AND conname = $2
      ) AS exists
    `,
    [`public.${tableName}`, constraintName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `Cannot baseline existing migrations: required constraint "${constraintName}" is missing.`,
    );
  }
}

async function assertIndexExists(client: PoolClient, indexName: string): Promise<void> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT to_regclass($1) IS NOT NULL AS exists
    `,
    [`public.${indexName}`],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `Cannot baseline existing migrations: required index "${indexName}" is missing.`,
    );
  }
}

async function assertColumnExists(
  client: PoolClient,
  tableName: string,
  columnName: string,
): Promise<void> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    [tableName, columnName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `Cannot baseline existing migrations: required column "${tableName}.${columnName}" is missing.`,
    );
  }
}

async function verifyExistingSchema(client: PoolClient): Promise<void> {
  const requiredTables = [
    'users',
    'user_addresses',
    'user_preferences',
    'partners',
    'pending_signups',
    'user_credentials',
    'vehicles',
  ];

  for (const tableName of requiredTables) {
    await assertTableExists(client, tableName);
  }

  await assertConstraintExists(client, 'partners', 'partners_rejection_reason_ck');

  const vehicleColumns = [
    'id',
    'driver_profile_id',
    'make',
    'model',
    'color',
    'plate_number',
    'is_active',
    'retired_at',
    'created_at',
    'updated_at',
  ];

  for (const columnName of vehicleColumns) {
    await assertColumnExists(client, 'vehicles', columnName);
  }

  await assertConstraintExists(client, 'vehicles', 'vehicles_active_retirement_ck');

  await assertIndexExists(client, 'vehicles_plate_number_active_uidx');
  await assertIndexExists(client, 'vehicles_one_active_per_driver_uidx');
  await assertIndexExists(client, 'vehicles_driver_profile_id_idx');
}

export async function baselineExistingMigrations(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [migrationLockKey]);

    try {
      await ensureMigrationTable(client);

      const appliedMigrations = await getAppliedMigrations(client);

      if (appliedMigrations.size > 0) {
        throw new Error('Cannot baseline existing migrations: schema_migrations is not empty.');
      }

      await verifyExistingSchema(client);

      await client.query('BEGIN');

      try {
        for (const filename of baselineMigrations) {
          await client.query(`INSERT INTO ${migrationTable} (filename) VALUES ($1)`, [filename]);
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      console.log(`Baselined ${baselineMigrations.length} existing migrations.`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [migrationLockKey]);
    }
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [migrationLockKey]);

    try {
      await ensureMigrationTable(client);

      const migrationFiles = await getMigrationFiles();
      const appliedMigrations = await getAppliedMigrations(client);

      for (const filename of migrationFiles) {
        if (appliedMigrations.has(filename)) {
          continue;
        }

        console.log(`Applying migration: ${filename}`);
        await applyMigration(client, filename);
        console.log(`Applied migration: ${filename}`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [migrationLockKey]);
    }
  } finally {
    client.release();
  }
}
