import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
const config = JSON.parse(
  execFileSync('docker', ['inspect', 'infurnus-postgres'], { encoding: 'utf8' }),
)[0];
if (
  !config.NetworkSettings.Ports['5432/tcp'].some(
    (p) => ['127.0.0.1', '0.0.0.0'].includes(p.HostIp) && p.HostPort === '5434',
  )
)
  throw Error('Loopback test database required');
const values = Object.fromEntries(
  config.Config.Env.map((s) => {
    const i = s.indexOf('=');
    return [s.slice(0, i), s.slice(i + 1)];
  }),
);
const name = 'admin_master_test_' + randomUUID().replaceAll('-', '');
if (!/^admin_master_test_[a-f0-9]{32}$/.test(name)) throw Error('Unsafe database name');
const url = new URL('postgresql://127.0.0.1:5434/postgres');
url.username = values.POSTGRES_USER || 'postgres';
url.password = values.POSTGRES_PASSWORD || '';
const admin = new Pool({ connectionString: url.toString() });
await admin.query('CREATE DATABASE "' + name + '"');
await admin.end();
url.pathname = '/' + name;
const evidenceFolder = process.env.INFURNUS_EVIDENCE_FOLDER ?? 'full-stack-20261025';
if (!/^[a-z0-9-]+$/.test(evidenceFolder)) throw Error('Invalid evidence folder');
const folder = resolve('docs/reports/evidence', evidenceFolder);
mkdirSync(folder, { recursive: true });
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS)$/i.test(
      k,
    ),
  ),
);
Object.assign(env, {
  NODE_ENV: 'test',
  DATABASE_URL: url.toString(),
  JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
  JWT_ACCESS_PREVIOUS_SECRET: randomBytes(48).toString('hex'),
  AUTH_OTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DOTENV_CONFIG_PATH: resolve('tmp/no-live-full-stack.env'),
  TEMP: resolve('tmp/auth-test-runtime'),
  TMP: resolve('tmp/auth-test-runtime'),
  DISPATCH_QA_REDIS_URL: 'redis://127.0.0.1:6379/10',
  RIDE_DB_TESTS: 'true',
  PROVIDER_DB_TESTS: 'true',
  DRIVER_IMPLEMENTATION_DB_TESTS: 'true',
  COUPON_DB_TESTS: 'true',
  RENTAL_DB_TESTS: 'true',
  AUTH_SECURITY_AUDIT_TESTS: 'true',
});
const targets = process.argv.slice(2);
const runLabel = targets.length ? 'backend-focused' : 'backend-full';
writeFileSync(
  resolve(folder, targets.length ? 'database-focused.json' : 'database.json'),
  JSON.stringify({ database: name, retained: true, isolated: true }, null, 2),
);
for (const [label, args] of [
  [
    targets.length ? 'migrations-focused' : 'migrations',
    ['node_modules/tsx/dist/cli.mjs', 'src/infrastructure/database/run-migrations.ts'],
  ],
  ...[
    [
      runLabel,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        ...targets,
        '--no-file-parallelism',
        '--reporter=default',
      ],
    ],
  ],
]) {
  try {
    const logPath = resolve(folder,label+'.log');
    const output = openSync(logPath,'w');
    try {
      execFileSync(process.execPath,args,{ env,stdio:['ignore',output,output],timeout:1200000 });
    } finally {closeSync(output);}
    const out=readFileSync(logPath,'utf8');
    console.log(label + ': passed');
    console.log(
      out
        .split('\n')
        .filter((x) => /Test Files|Tests\s|Duration/.test(x))
        .join('\n'),
    );
  } catch (e) {
    // Preserve the streamed evidence, including partial output on a timeout.
    console.log('runner error: '+(e.code ?? e.signal ?? 'test failure'));
    console.log(label + ': failed (see evidence log)');
    process.exitCode = 1;
    break;
  }
}
