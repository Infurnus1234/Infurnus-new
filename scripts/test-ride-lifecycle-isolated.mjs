import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
const config = JSON.parse(
  execFileSync('docker', ['inspect', 'infurnus-driver-fleet-audit-postgres'], { encoding: 'utf8' }),
)[0];
const values = Object.fromEntries(
  config.Config.Env.map((x) => {
    const i = x.indexOf('=');
    return [x.slice(0, i), x.slice(i + 1)];
  }),
);
const url = new URL('postgresql://127.0.0.1:5434/postgres');
url.username = values.POSTGRES_USER ?? 'postgres';
url.password = values.POSTGRES_PASSWORD;
const name = 'infurnus_ride_security_' + randomUUID().replaceAll('-', '');
if (!/^infurnus_ride_security_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe fixture name');
const admin = new pg.Pool({ connectionString: url.toString() });
url.pathname = '/' + name;
const folder = resolve('tmp/ride-lifecycle');
mkdirSync(folder, { recursive: true });
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  DOTENV_CONFIG_PATH: resolve(folder, 'isolated.env'),
  TEMP: folder,
  TMP: folder,
  MSG91_AUTH_KEY: undefined,
  RESEND_API_KEY: undefined,
  OTP_PROVIDER_CONFIG: undefined,
  RIDE_DB_TESTS: 'true',
  PROVIDER_DB_TESTS: 'true',
  DRIVER_IMPLEMENTATION_DB_TESTS: 'true',
};
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  for (const [label, args] of [
    [
      'migrations',
      ['node_modules/tsx/dist/cli.mjs', 'src/infrastructure/database/run-migrations.ts'],
    ],
    ['backfill', ['node_modules/tsx/dist/cli.mjs', 'scripts/backfill-ride-pin-secrets.ts']],
    [
      'tests',
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        'src/modules/providers/tests',
        'src/modules/rides/tests',
        'src/infrastructure/socket/tests',
        'src/modules/partners/tests',
        'src/infrastructure/storage/tests',
        '--no-file-parallelism',
        '--reporter=dot',
      ],
    ],
  ]) {
    const result = spawnSync(process.execPath, args, {
      env,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    writeFileSync(resolve(folder, label + '.log'), output);
    console.log(label + ': ' + (result.status === 0 ? 'PASS' : 'FAIL'));
    for (const line of output.split('\n').filter((x) => /Test Files|Tests\s|Duration/.test(x)))
      console.log(line);
    if (result.status !== 0)
      throw new Error(label + ' failed; see tmp/ride-lifecycle/' + label + '.log');
  }
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
