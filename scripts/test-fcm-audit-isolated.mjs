import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
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
const name = 'admin_master_test_' + randomUUID().replaceAll('-', '');
const redisName = 'infurnus-fcm-audit-' + randomUUID().replaceAll('-', '');
if (
  !/^admin_master_test_[a-f0-9]{32}$/.test(name) ||
  !/^infurnus-fcm-audit-[a-f0-9]{32}$/.test(redisName)
)
  throw new Error('Invalid fixture names');
const url = new URL('postgresql://localhost:5434/postgres');
url.username = values.POSTGRES_USER ?? 'postgres';
url.password = values.POSTGRES_PASSWORD;
const admin = new pg.Pool({ connectionString: url.toString() });
url.pathname = '/' + name;
const folder = resolve('tmp/fcm-audit');
mkdirSync(folder, { recursive: true });
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS)$/i.test(
      key,
    ),
  ),
);
Object.assign(env, {
  NODE_ENV: 'test',
  DATABASE_URL: url.toString(),
  JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
  JWT_ACCESS_PREVIOUS_SECRET: randomBytes(48).toString('hex'),
  AUTH_OTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DOTENV_CONFIG_PATH: resolve(folder, 'no-live-credentials.env'),
  TEMP: folder,
  TMP: folder,
  RIDE_DB_TESTS: 'true',
  PROVIDER_DB_TESTS: 'true',
  DRIVER_IMPLEMENTATION_DB_TESTS: 'true',
  COUPON_DB_TESTS: 'true',
  RENTAL_DB_TESTS: 'true',
  MAP_REDIS_TESTS: 'true',
  REDIS_DISPATCH_TESTS: 'true',
  FCM_AUDIT_DB_TESTS: 'true',
  GOOGLE_MAPS_API_KEY: 'non-secret-fixture',
});
let created = false,
  redis = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  execFileSync(
    'docker',
    ['run', '--rm', '-d', '--name', redisName, '-p', '127.0.0.1::6379', 'redis:7-alpine'],
    { stdio: 'pipe' },
  );
  redis = true;
  const info = JSON.parse(execFileSync('docker', ['inspect', redisName], { encoding: 'utf8' }))[0];
  const port = info.NetworkSettings.Ports['6379/tcp'][0].HostPort;
  env.REDIS_URL = 'redis://127.0.0.1:' + port;
  env.DISPATCH_QA_REDIS_URL = env.REDIS_URL;
  for (const [label, args] of [
    ['build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']],
    [
      'migrations',
      ['node_modules/tsx/dist/cli.mjs', 'src/infrastructure/database/run-migrations.ts'],
    ],
    ['migration-validation', ['node_modules/tsx/dist/cli.mjs', 'scripts/test-migrations.ts']],
    ['pin-backfill', ['node_modules/tsx/dist/cli.mjs', 'scripts/backfill-ride-pin-secrets.ts']],
    [
      'tests',
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        ...process.argv.slice(2),
        '--no-file-parallelism',
        '--reporter=dot',
      ],
    ],
  ]) {
    const result = spawnSync(process.execPath, args, {
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    writeFileSync(resolve(folder, label + '.log'), output);
    console.log(label + ': ' + (result.status === 0 ? 'PASS' : 'FAIL'));
    for (const line of output.split('\n').filter((x) => /Test Files|Tests\s|Duration/.test(x)))
      console.log(line);
    if (result.status !== 0)
      throw new Error(label + ' failed: inspect tmp/fcm-audit/' + label + '.log');
    if (label === 'build') {
      const denied = spawnSync(
        process.execPath,
        ['dist/infrastructure/queue/notification-worker.js'],
        { env, encoding: 'utf8', timeout: 10000 },
      );
      const diagnostic = (denied.stdout ?? '') + (denied.stderr ?? '');
      writeFileSync(resolve(folder, 'worker-missing-credentials.log'), diagnostic);
      if (
        denied.status === 0 ||
        !diagnostic.includes(
          'Notification worker requires Redis and complete Firebase service configuration',
        )
      )
        throw new Error('Worker failed to reject missing credentials');
      console.log('worker-missing-credentials: PASS (startup rejected, no FCM send)');
    }
  }
} finally {
  if (redis) execFileSync('docker', ['stop', redisName], { stdio: 'pipe' });
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
