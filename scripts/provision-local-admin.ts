import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { provisionAdministrativeAccount } from '../src/modules/auth/services/admin-provision.service.js';

// This command deliberately cannot provision production or unidentified forwards.
const connection = process.env.DATABASE_URL;
const expectedDatabase = process.env.ADMIN_PROVISION_EXPECTED_DATABASE;
const expectedAddress = process.env.ADMIN_PROVISION_EXPECTED_SERVER_ADDRESS;
const email = process.env.ADMIN_PROVISION_EMAIL;
const role = process.env.ADMIN_PROVISION_ROLE;
const passwordFile = process.env.ADMIN_PROVISION_PASSWORD_FILE;
if (
  !connection ||
  !expectedDatabase ||
  !expectedAddress ||
  !email ||
  !passwordFile ||
  (role !== 'admin' && role !== 'super_admin')
)
  throw new Error('Explicit local database, approved role, email and password file are required');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(connection).hostname))
  throw new Error('Local provisioning only');
const database = new Pool({ connectionString: connection });
try {
  const target = await database.query<{ name: string; address: string }>(
    'SELECT current_database() AS name, host(inet_server_addr()) AS address',
  );
  if (target.rows[0]?.name !== expectedDatabase || target.rows[0]?.address !== expectedAddress)
    throw new Error('Database target does not match the verified local target');
  const password = (await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '');
  const result = await provisionAdministrativeAccount(database, {
    email,
    password,
    role,
    firstName: process.env.ADMIN_PROVISION_FIRST_NAME || 'Administrative',
    lastName: process.env.ADMIN_PROVISION_LAST_NAME || '',
  });
  console.log(JSON.stringify(result));
} catch {
  console.error('Provisioning refused or failed; no credential details are logged.');
  process.exitCode = 1;
} finally {
  await database.end();
}
