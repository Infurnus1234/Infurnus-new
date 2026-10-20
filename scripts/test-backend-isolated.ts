import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

// A fresh database makes missing migrations fail before auth assertions run.
const source = new URL(process.env.AUTH_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname))
  throw new Error('Isolated backend tests require a local PostgreSQL server');
if (source.port !== '5434')
  throw new Error('Set AUTH_TEST_DATABASE_URL to the local audit PostgreSQL server on port 5434');
const name = `infurnus_backend_test_${randomUUID().replaceAll('-', '')}`;
if (!/^infurnus_backend_test_[a-f0-9]{32}$/.test(name))
  throw new Error('Unsafe test database name');
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const testUrl = new URL(source);
testUrl.pathname = `/${name}`;
const admin = new Pool({ connectionString: adminUrl.toString() });
const run = promisify(execFile);
const logDir = resolve('tmp/auth-completion');
await mkdir(logDir, { recursive: true });
const tempDir = resolve('tmp/auth-test-runtime');
await mkdir(tempDir, { recursive: true });
const childEnv = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  // Automated suites must never inherit live delivery credentials from dotenv.
  DOTENV_CONFIG_PATH: resolve(tempDir, 'isolated-tests.env'),
  MSG91_AUTH_KEY: undefined,
  MSG91_TEMPLATE_ID: undefined,
  RESEND_API_KEY: undefined,
  OTP_PROVIDER_CONFIG: undefined,
  TEMP: tempDir,
  TMP: tempDir,
  RIDE_DB_TESTS: 'true',
  PROVIDER_DB_TESTS: 'true',
  DRIVER_IMPLEMENTATION_DB_TESTS: 'true',
  COUPON_DB_TESTS: 'true',
  RENTAL_DB_TESTS: 'true',
};
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  for (const [label, command] of [
    [
      'isolated-migrations',
      ['node_modules/tsx/dist/cli.mjs', 'src/infrastructure/database/run-migrations.ts'],
    ],
    [
      'isolated-auth',
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        'src/modules/auth/tests',
        '--no-file-parallelism',
        '--reporter=dot',
      ],
    ],
    [
      'isolated-full',
      ['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', '--reporter=dot'],
    ],
  ] as const) {
    try {
      const result = await run(process.execPath, [...command], {
        env: childEnv,
        maxBuffer: 32 * 1024 * 1024,
      });
      await writeFile(resolve(logDir, `${label}.log`), result.stdout + result.stderr);
      console.log(`${label}: passed`);
      for (const line of result.stdout
        .split('\n')
        .filter((line) => /Test Files|Tests\s|Duration/.test(line)))
        console.log(line);
    } catch (error) {
      const output = error as { stdout?: string; stderr?: string };
      await writeFile(
        resolve(logDir, `${label}.log`),
        (output.stdout ?? '') + (output.stderr ?? ''),
      );
      throw new Error(`${label} failed; inspect tmp/auth-completion/${label}.log`);
    }
  }
} finally {
  if (created) {
    // Only the database created above is eligible for cleanup.
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.end();
}
