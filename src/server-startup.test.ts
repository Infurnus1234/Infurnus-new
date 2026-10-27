import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'API startup without push services',
  () => {
    it('serves database readiness without Redis or Firebase configuration', async () => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Owned disposable database required');
      const reservation = createServer();
      await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((resolve, reject) =>
        reservation.close((e) => (e ? reject(e) : resolve())),
      );
      const environment = {
        ...process.env,
        NODE_ENV: 'development',
        SERVER_HOST: '127.0.0.1',
        PORT: String(port),
      };
      for (const key of Object.keys(environment))
        if (/^(REDIS_|FIREBASE_|LOCAL_DOCUMENT_STORAGE_ROOT$)/.test(key))
          delete environment[key as keyof typeof environment];
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: process.cwd(),
        env: environment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('API readiness startup timeout')), 25000);
          child.once('exit', () => {
            clearTimeout(timeout);
            reject(Error('API exited before readiness'));
          });
          child.stdout.on('data', (bytes) => {
            output += String(bytes);
            if (output.includes('INFURNUS API active')) {
              clearTimeout(timeout);
              resolve();
            }
          });
          child.stderr.resume();
          child.once('error', (e) => {
            clearTimeout(timeout);
            reject(e);
          });
        });
        const response = await fetch(`http://127.0.0.1:${port}/ready`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          success: true,
          data: { ready: true, database: 'connected' },
        });
      } finally {
        child.kill();
      }
    }, 30000);
  },
);
