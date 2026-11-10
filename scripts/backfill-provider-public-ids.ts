import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { pool } from '../src/infrastructure/database/postgres.js';

// Default is an inventory-only transaction. Explicit target and restore proof are mandatory
// for writes. Keep manifests private: they contain internal account UUIDs, not credentials.
const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const apply = args.includes('--apply');
const batch = args.includes('--batch') ? option('--batch')! : 'inventory';
const output = args.includes('--output') ? option('--output')! : 'provider-identity-mapping.json';
const client = await pool.connect();
try {
  const database = (await client.query('SELECT current_database() AS name')).rows[0].name as string;
  if (apply) {
    if (!args.includes('--database') || option('--database') !== database || batch === 'inventory')
      throw new Error('--apply requires exact --database and a named --batch');
    if (!args.includes('--backup-proof'))
      throw new Error('Verified backup and isolated restore proof required');
    const { readFile } = await import('node:fs/promises');
    const proof = JSON.parse(await readFile(option('--backup-proof')!, 'utf8'));
    if (
      proof.database !== database ||
      proof.backupVerified !== true ||
      proof.restoreVerified !== true ||
      !proof.backupId ||
      !proof.restoredDatabase ||
      !proof.verifiedAt
    )
      throw new Error(
        'Backup proof must identify this database, verified backup, isolated restored database and verification time',
      );
  }
  const excludedSql = `SELECT role::text,count(*)::int AS count,
    md5(COALESCE(string_agg(to_jsonb(u)::text,',' ORDER BY id),'')) AS checksum
    FROM users u WHERE role IN ('customer','admin','super_admin') GROUP BY role ORDER BY role`;
  const before = (await client.query(excludedSql)).rows;
  const applied = (await client.query('SELECT filename FROM schema_migrations ORDER BY filename'))
    .rows;
  if (!applied.some((r) => r.filename === '100_provider_public_identity.sql'))
    throw new Error('Public identity migration must be applied first');
  const accounts = (
    await client.query(`SELECT u.id,u.role,u.deleted_at,
    (SELECT p.id FROM partners p WHERE p.user_id=u.id) AS partner_id,
    (SELECT d.id FROM driver_profiles d WHERE d.user_id=u.id) AS driver_profile_id,
    provider_public_id(u.id) AS public_id FROM users u
    WHERE u.role IN ('driver','fleet_owner','driver_fleet_owner') ORDER BY u.created_at,u.id`)
  ).rows;
  const unresolved: { accountId: string; code: string }[] = [];
  for (const account of accounts) {
    if (account.public_id) continue;
    const ambiguous = await client.query(
      `SELECT 1 FROM users mine JOIN users other ON mine.id<>other.id
      AND other.role IN ('driver','fleet_owner','driver_fleet_owner') AND
      ((mine.email IS NOT NULL AND lower(btrim(mine.email))=lower(btrim(other.email))) OR
       (mine.phone IS NOT NULL AND ltrim(btrim(mine.phone),'+')=ltrim(btrim(other.phone),'+')))
      WHERE mine.id=$1 LIMIT 1`,
      [account.id],
    );
    if (ambiguous.rowCount) {
      unresolved.push({ accountId: account.id, code: 'OWNERSHIP_RECONCILIATION_REQUIRED' });
      if (apply)
        await client.query(
          `INSERT INTO provider_identity_reconciliation(account_id,reason,batch_id)
        VALUES($1,'shared_provider_contact',$2) ON CONFLICT(account_id) DO UPDATE SET batch_id=$2,updated_at=clock_timestamp()`,
          [account.id, batch],
        );
      continue;
    }
    if (apply) {
      await client.query('BEGIN');
      try {
        account.public_id = (
          await client.query("SELECT ensure_provider_identity($1,'backfill',$2) AS id", [
            account.id,
            batch,
          ])
        ).rows[0].id;
        if (account.deleted_at)
          await client.query(
            `UPDATE provider_identities i SET tombstoned_at=COALESCE(i.tombstoned_at,$2)
          FROM provider_identity_accounts a WHERE a.account_id=$1 AND i.id=a.identity_id`,
            [account.id, account.deleted_at],
          );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code !== 'P1001') throw error;
        unresolved.push({ accountId: account.id, code: 'CONCURRENT_RECONCILIATION_REQUIRED' });
      }
    }
  }
  const after = (await client.query(excludedSql)).rows;
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(
      'Excluded account snapshot changed; investigate concurrent writes before cutover',
    );
  const invalid = (
    await client.query(
      `SELECT count(*)::int AS count FROM provider_identities WHERE public_id !~ '^[1-9][0-9]{5,63}$'`,
    )
  ).rows[0].count;
  const excludedMemberships = (
    await client.query(
      `SELECT count(*)::int AS count FROM provider_identity_accounts a JOIN users u ON u.id=a.user_id WHERE u.role NOT IN ('driver','fleet_owner','driver_fleet_owner')`,
    )
  ).rows[0].count;
  const duplicates = (
    await client.query(
      'SELECT public_id FROM provider_identities GROUP BY public_id HAVING count(*)>1',
    )
  ).rowCount;
  const missing = (
    await client.query(
      `SELECT count(*)::int AS count FROM users WHERE role IN ('driver','fleet_owner','driver_fleet_owner') AND provider_public_id(id) IS NULL`,
    )
  ).rows[0].count;
  const verifiedAliases = (
    await client.query(
      `SELECT COALESCE(sum(n-1),0)::int AS count FROM (SELECT count(*) n FROM provider_identity_accounts GROUP BY identity_id) x`,
    )
  ).rows[0].count;
  const report = {
    database,
    mode: apply ? 'apply' : 'inventory',
    batch,
    appliedMigrations: applied,
    counts: {
      eligibleAccounts: accounts.length,
      mappedAccounts: accounts.filter((a) => a.public_id).length,
      missing,
      verifiedAliases,
      unresolved: unresolved.length,
      invalid,
      duplicates,
      excludedMemberships,
    },
    byRole: ['driver', 'fleet_owner', 'driver_fleet_owner'].map((role) => ({
      role,
      accounts: accounts.filter((a) => a.role === role).length,
      mapped: accounts.filter((a) => a.role === role && a.public_id).length,
    })),
    partnerProfilesMapped: accounts.filter((a) => a.partner_id && a.public_id).length,
    excludedBefore: before,
    excludedAfter: after,
    unresolved,
    mapping: accounts,
  };
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, mapping: undefined, appliedMigrations: undefined }));
  if (invalid || duplicates || excludedMemberships || (apply && missing)) process.exitCode = 2;
} finally {
  client.release();
  await pool.end();
}
