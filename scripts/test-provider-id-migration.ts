import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { pool } from '../src/infrastructure/database/postgres.js';
import { ProviderIdentityRepository } from '../src/modules/providers/repositories/provider-identity.repository.js';

const database = (await pool.query('SELECT current_database() AS name')).rows[0].name as string;
if (!/^(provider_id_test|admin_master_test)_[a-f0-9]{32}$/.test(database))
  throw new Error('Migration rehearsal only permits a disposable provider test database');
const out = resolve('tmp/provider-public-id');
const ids = Array.from({ length: 9 }, () => randomUUID());
const roles = [
  'driver',
  'fleet_owner',
  'driver_fleet_owner',
  'driver',
  'driver',
  'fleet_owner',
  'customer',
  'admin',
  'super_admin',
];
const restored = `provider_id_restore_${randomUUID().replaceAll('-', '')}`;
let restoreCreated = false;
try {
  // Emulate pre-migration rows, including two unresolved role-scoped accounts.
  // This trigger toggle is restricted to this newly created, isolated test database.
  await pool.query('ALTER TABLE users DISABLE TRIGGER users_provider_identity');
  await pool.query('ALTER TABLE partners DISABLE TRIGGER partners_provider_identity');
  try {
    for (const [index, id] of ids.entries())
      await pool.query(
        `INSERT INTO users(id,first_name,last_name,email,role,deleted_at) VALUES($1,'Legacy','Fixture',$2,$3,$4)`,
        [
          id,
          (index === 5 ? ids[4] : id) + '@example.invalid',
          roles[index],
          index === 3 ? new Date() : null,
        ],
      );
    for (const index of [1, 2])
      await pool.query("INSERT INTO partners(user_id,business_name) VALUES($1,'Legacy Fleet')", [
        ids[index],
      ]);
  } finally {
    await pool.query('ALTER TABLE users ENABLE TRIGGER users_provider_identity');
    await pool.query('ALTER TABLE partners ENABLE TRIGGER partners_provider_identity');
  }
  const dbUser = (await pool.query('SELECT current_user AS name')).rows[0].name as string;
  const dump = execFileSync(
    'docker',
    [
      'exec',
      'infurnus-postgres',
      'pg_dump',
      '-U',
      dbUser,
      '--no-owner',
      '--no-privileges',
      database,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  await pool.query(`CREATE DATABASE "${restored}"`);
  restoreCreated = true;
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'infurnus-postgres',
      'psql',
      '-U',
      dbUser,
      '-d',
      restored,
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: dump, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  );
  const restoredCount = execFileSync(
    'docker',
    [
      'exec',
      'infurnus-postgres',
      'psql',
      '-U',
      dbUser,
      '-d',
      restored,
      '-Atc',
      'SELECT count(*) FROM users',
    ],
    { encoding: 'utf8' },
  ).trim();
  assert.equal(restoredCount, '9');
  const proof = {
    database,
    backupId: 'isolated-pg-dump',
    backupVerified: dump.length > 0,
    restoreVerified: true,
    restoredDatabase: restored,
    verifiedAt: new Date().toISOString(),
    restoredAccounts: 9,
  };
  const proofPath = resolve(out, 'rehearsal-backup-proof.json');
  await writeFile(proofPath, JSON.stringify(proof, null, 2));
  function backfill(label: string) {
    const output = resolve(out, label + '.json');
    const run = spawnSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/backfill-provider-public-ids.ts',
        '--apply',
        '--database',
        database,
        '--batch',
        'rehearsal',
        '--backup-proof',
        proofPath,
        '--output',
        output,
      ],
      { encoding: 'utf8', env: process.env },
    );
    if (run.status !== 0 && run.status !== 2)
      throw new Error('Backfill process failed: ' + run.stderr);
    return output;
  }
  const first = JSON.parse(await readFile(backfill('rehearsal-first'), 'utf8'));
  assert.equal(first.counts.mappedAccounts, 4);
  assert.equal(first.counts.unresolved, 2);
  const link = await new ProviderIdentityRepository(pool).linkVerified(
    ids[4]!,
    ids[5]!,
    'isolated verified ownership fixture',
  );
  assert.match(link.publicId, /^[1-9][0-9]{5}$/);
  const resumed = JSON.parse(await readFile(backfill('rehearsal-resumed'), 'utf8'));
  assert.equal(resumed.counts.mappedAccounts, 6);
  assert.equal(resumed.counts.missing, 0);
  assert.equal(resumed.counts.verifiedAliases, 1);
  assert.equal(resumed.counts.invalid, 0);
  assert.equal(resumed.counts.duplicates, 0);
  assert.equal(resumed.counts.excludedMemberships, 0);
  const repeated = JSON.parse(await readFile(backfill('rehearsal-repeated'), 'utf8'));
  assert.deepEqual(repeated.mapping, resumed.mapping);
  assert.deepEqual(repeated.excludedBefore, first.excludedBefore);
  const publicBefore = (
    await pool.query('SELECT public_id FROM provider_identities ORDER BY public_id')
  ).rows;
  for (const extra of [[], ['--resume']]) {
    const rollback = spawnSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/rollback-provider-public-ids.ts',
        ids[8]!,
        database,
        ...extra,
      ],
      { encoding: 'utf8', env: process.env },
    );
    assert.equal(rollback.status, 0, rollback.stderr);
  }
  assert.deepEqual(
    (await pool.query('SELECT public_id FROM provider_identities ORDER BY public_id')).rows,
    publicBefore,
  );
  await writeFile(
    resolve(out, 'rehearsal-summary.json'),
    JSON.stringify(
      {
        status: 'PASS',
        legacyEligible: 6,
        migratedAccounts: 6,
        canonicalIdentities: 5,
        partnerProfiles: 2,
        roles: resumed.byRole,
        verifiedAliases: 1,
        unresolved: 0,
        invalid: 0,
        duplicateIds: 0,
        excludedUnchanged: true,
        backupRestored: true,
        resumeIdempotent: true,
        rollbackRetainsIds: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Migration rehearsal: PASS (6 legacy accounts, 5 identities, 1 verified alias; real backup/restore, resume and rollback)',
  );
} finally {
  if (restoreCreated) {
    await pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [
      restored,
    ]);
    await pool.query(`DROP DATABASE "${restored}"`);
  }
  await pool.end();
}
