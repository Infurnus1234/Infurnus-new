import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import {
  remediateRouteContent,
  parseRouteRemediationIds,
} from '../src/modules/maps/map-operations.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let database: Pool | undefined;
  try {
    const { readFile } = await import('node:fs/promises');
    const file = process.argv
      .find((arg) => arg.startsWith('--ids-file='))
      ?.slice('--ids-file='.length);
    if (!file) throw new Error('Explicit owner-reviewed IDs file required');
    const ids = parseRouteRemediationIds(JSON.parse(await readFile(file, 'utf8')));
    database = (await import('../src/infrastructure/database/postgres.js')).pool;
    console.log(
      JSON.stringify(
        await remediateRouteContent(
          database,
          ids,
          process.argv.includes('--apply'),
          process.env.INFURNUS_ROUTE_REMEDIATION_APPROVED === 'true',
        ),
      ),
    );
  } catch {
    console.error(
      'Route-content remediation failed; check reviewed IDs and explicit owner approval',
    );
    process.exitCode = 1;
  } finally {
    await database?.end();
  }
}
