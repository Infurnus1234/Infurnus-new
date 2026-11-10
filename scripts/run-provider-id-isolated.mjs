import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

// Dedicated disposable database only. Never loads deployment secrets or a target URL.
const container = JSON.parse(
  execFileSync('docker', ['inspect', 'infurnus-postgres'], { encoding: 'utf8' }),
)[0];
const vars = Object.fromEntries(
  container.Config.Env.map((v) => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]),
);
const base = new URL('postgresql://127.0.0.1:5434/postgres');
base.username = vars.POSTGRES_USER;
base.password = vars.POSTGRES_PASSWORD;
const admin = new pg.Client({ connectionString: base.toString() });
const name = `admin_master_test_${randomUUID().replaceAll('-', '')}`;
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
base.pathname = '/' + name;
const out = resolve('tmp/provider-public-id');
mkdirSync(out, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: base.toString(),
  JWT_ACCESS_SECRET: 'isolated-provider-id-tests-secret-32-characters',
  JWT_ACCESS_PREVIOUS_SECRET: 'isolated-previous-provider-id-secret-32-characters',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  DOTENV_CONFIG_PATH: resolve(out, 'absent.env'),
  RIDE_DB_TESTS: 'true',
  PROVIDER_DB_TESTS: 'true',
  DISPATCH_QA_REDIS_URL: 'redis://127.0.0.1:6379',
  DRIVER_IMPLEMENTATION_DB_TESTS: 'true',
  COUPON_DB_TESTS: 'true',
  RENTAL_DB_TESTS: 'true',
  AUTH_OTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const servers = [];
async function server(label, args, cwd, extra, marker) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    servers.push(child);
    let log = '';
    const timeout = setTimeout(() => reject(new Error(label + ' startup timeout')), 120000);
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (d) => {
        log += d;
        writeFileSync(resolve(out, label + '.log'), log);
        if (log.includes(marker)) {
          clearTimeout(timeout);
          done();
        }
      });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code) reject(new Error(label + ' exited: ' + code));
    });
  });
}
for (const key of [
  'MSG91_AUTH_KEY',
  'MSG91_TEMPLATE_ID',
  'RESEND_API_KEY',
  'OTP_PROVIDER_CONFIG',
  'GOOGLE_CLIENT_SECRET',
])
  delete env[key];
async function run(label, args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      output += d;
      process.stderr.write(d);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      writeFileSync(resolve(out, label + '.log'), output);
      code === 0 ? done() : reject(new Error(label + ' failed: ' + code));
    });
  });
}
try {
  await run('migrations', [
    'node_modules/tsx/dist/cli.mjs',
    'src/infrastructure/database/run-migrations.ts',
  ]);
  const targets = process.argv.slice(2);
  if (targets.includes('--rehearsal')) {
    await run('rehearsal', [
      'node_modules/tsx/dist/cli.mjs',
      'scripts/test-provider-id-migration.ts',
    ]);
  } else if (targets.includes('--ui')) {
    await server(
      'ui-backend',
      ['node_modules/tsx/dist/cli.mjs', 'scripts/provider-id-ui-server.ts'],
      process.cwd(),
      {},
      'PUBLIC_ID_UI_READY',
    );
    await server(
      'ui-admin',
      ['scripts/provider-id-ui-server.mjs'],
      resolve('../admin-deployment-20261022'),
      {
        NODE_ENV: 'development',
        BACKEND_API_URL: 'http://127.0.0.1:3186',
        ADMIN_APP_ORIGIN: 'http://127.0.0.1:3187',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      'PUBLIC_ID_ADMIN_READY',
    );
    await run('ui-browser', ['scripts/test-provider-id-ui.mjs']);
  } else {
    await run(targets.length ? 'focused' : 'regression', [
      'node_modules/vitest/vitest.mjs',
      'run',
      ...targets,
      '--no-file-parallelism',
      '--reporter=dot',
    ]);
  }
} finally {
  for (const child of servers) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    } else child.kill('SIGTERM');
  }
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
    [name],
  );
  await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
